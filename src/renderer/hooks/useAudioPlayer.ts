import { useState, useRef, useCallback, useEffect } from 'react';

interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
}

interface AudioPlayerControls {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  setRate: (rate: number) => void;
  load: (src: string) => void;
}

export function useAudioPlayer(): [AudioPlayerState, AudioPlayerControls] {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animRef = useRef<number>(0);

  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
  });

  // Animation-frame–based time tracking for smooth updates
  const tick = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      setState(prev => ({
        ...prev,
        currentTime: audioRef.current!.currentTime,
      }));
      animRef.current = requestAnimationFrame(tick);
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const load = useCallback((src: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      cancelAnimationFrame(animRef.current);
    }

    const audio = new Audio(src);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      setState(prev => ({ ...prev, duration: audio.duration, currentTime: 0 }));
    });

    audio.addEventListener('ended', () => {
      cancelAnimationFrame(animRef.current);
      setState(prev => ({ ...prev, isPlaying: false }));
    });

    audio.addEventListener('pause', () => {
      cancelAnimationFrame(animRef.current);
      setState(prev => ({ ...prev, isPlaying: false }));
    });

    audio.addEventListener('play', () => {
      setState(prev => ({ ...prev, isPlaying: true }));
      animRef.current = requestAnimationFrame(tick);
    });
  }, [tick]);

  const play = useCallback(() => { audioRef.current?.play(); }, []);
  const pause = useCallback(() => { audioRef.current?.pause(); }, []);
  const toggle = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) audioRef.current.play();
    else audioRef.current.pause();
  }, []);

  const seek = useCallback((time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setState(prev => ({ ...prev, currentTime: time }));
  }, []);

  const setRate = useCallback((rate: number) => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
    setState(prev => ({ ...prev, playbackRate: rate }));
  }, []);

  return [state, { play, pause, toggle, seek, setRate, load }];
}
