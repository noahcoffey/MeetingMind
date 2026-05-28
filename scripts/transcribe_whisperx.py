#!/usr/bin/env python3
"""
transcribe_whisperx.py — on-device transcription + diarization runner.

Node (src/main/transcription.ts) spawns this as a subprocess, the same way it
spawns ffmpeg. It loads WhisperX, transcribes the audio, aligns word timestamps,
optionally runs pyannote speaker diarization, and writes normalized JSON that
matches the utterance format used by the AssemblyAI / Deepgram providers.

CLI:
  python transcribe_whisperx.py \
    --audio <path>            absolute path to the audio file (.m4a etc.)
    --model <size>            e.g. large-v3-turbo, medium, small
    --hf-token <token>        HuggingFace token for pyannote (may be empty)
    --output <path>           where to write the result JSON
    --model-cache-dir <path>  where to cache downloaded model weights
    --language <code>         optional ISO 639-1; omit to auto-detect

Progress is emitted to stdout as newline-delimited JSON. Every line is one of:
  {"type":"progress","status":"loading_model","message":"...","progress":10}
  {"type":"done","output_path":"/abs/path/to/output.json"}
  {"type":"error","message":"..."}

All output uses flush=True so Node receives lines in real time.
"""

import argparse
import json
import os
import sys
import traceback


def emit(obj):
    """Write one NDJSON line to stdout, flushed immediately."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def progress(status, message, pct):
    emit({"type": "progress", "status": status, "message": message, "progress": pct})


def pick_device_and_compute_type():
    """WhisperX uses CTranslate2, which does not support Apple MPS. Use CPU with
    int8 there; use CUDA float16 if an NVIDIA GPU is available (e.g. on Windows)."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--hf-token", default="")
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-cache-dir", default=None)
    parser.add_argument("--language", default="")
    args = parser.parse_args()

    if not os.path.isfile(args.audio):
        emit({"type": "error", "message": f"Audio file not found: {args.audio}"})
        sys.exit(1)

    try:
        import whisperx
    except Exception as e:
        emit({"type": "error",
              "message": f"Failed to import whisperx — is the environment set up? ({e})"})
        sys.exit(1)

    device, compute_type = pick_device_and_compute_type()
    language = args.language.strip() or None

    try:
        # 1. Load the Whisper model -------------------------------------------------
        progress("loading_model", "Loading Whisper model...", 10)
        model = whisperx.load_model(
            args.model,
            device,
            compute_type=compute_type,
            download_root=args.model_cache_dir,
            language=language,
        )

        # 2. Transcribe -------------------------------------------------------------
        progress("transcribing", "Transcribing audio...", 40)
        audio = whisperx.load_audio(args.audio)
        result = model.transcribe(audio, batch_size=16, language=language)
        detected_language = result.get("language", language or "en")
        audio_duration = round(len(audio) / 16000.0, 2)  # whisperx loads at 16 kHz

        # 3. Align word timestamps --------------------------------------------------
        progress("aligning", "Aligning word timestamps...", 70)
        try:
            align_model, metadata = whisperx.load_align_model(
                language_code=detected_language, device=device
            )
            result = whisperx.align(
                result["segments"], align_model, metadata, audio, device,
                return_char_alignments=False,
            )
        except Exception as e:
            # Alignment is a refinement; if it fails, keep the unaligned segments.
            sys.stderr.write(f"Alignment skipped: {e}\n")

        # 4. Diarize (optional) -----------------------------------------------------
        diarized = False
        if args.hf_token.strip():
            try:
                progress("diarizing", "Running speaker diarization...", 85)
                # DiarizationPipeline moved across whisperx versions; try both.
                try:
                    from whisperx.diarize import DiarizationPipeline
                except Exception:
                    from whisperx import DiarizationPipeline
                token = args.hf_token.strip()
                # pyannote.audio >=4 renamed the auth kwarg to `token`; older
                # versions used `use_auth_token`. Pin the diarization model so it
                # matches the license the user is asked to accept in Settings.
                # whisperx 3.8.x / pyannote 4.x use the community-1 pipeline (the
                # old speaker-diarization-3.1 name now resolves to it anyway).
                model_name = "pyannote/speaker-diarization-community-1"
                try:
                    diarize_model = DiarizationPipeline(model_name=model_name, token=token, device=device)
                except TypeError:
                    diarize_model = DiarizationPipeline(model_name=model_name, use_auth_token=token, device=device)
                diarize_segments = diarize_model(audio)
                result = whisperx.assign_word_speakers(diarize_segments, result)
                diarized = True
            except Exception as e:
                # Surface the failure to the app instead of silently single-speakering.
                progress("diarizing", f"Speaker diarization unavailable — using single speaker ({e})", 88)
                sys.stderr.write(f"Diarization failed, falling back to single speaker: {e}\n")

        # 5. Build normalized output ------------------------------------------------
        utterances = []
        full_text_parts = []
        for seg in result.get("segments", []):
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            # whisperx emits speaker labels like "SPEAKER_00"; normalize to "Speaker N".
            raw_speaker = seg.get("speaker")
            if diarized and raw_speaker:
                num = raw_speaker.split("_")[-1]
                try:
                    speaker = f"Speaker {int(num) + 1}"
                except ValueError:
                    speaker = "Speaker 1"
            else:
                speaker = "Speaker 1"
            utterances.append({
                "speaker": speaker,
                "text": text,
                "start": int(round((seg.get("start") or 0) * 1000)),  # ms
                "end": int(round((seg.get("end") or 0) * 1000)),      # ms
                "confidence": round(float(seg.get("score", 0.9) or 0.9), 4),
            })
            full_text_parts.append(text)

        output = {
            "provider": "whisperx-local",
            "model": args.model,
            "audio_duration": audio_duration,
            "text": " ".join(full_text_parts),
            "utterances": utterances,
        }

        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False)

        emit({"type": "done", "output_path": args.output})
    except Exception as e:
        sys.stderr.write(traceback.format_exc())
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
