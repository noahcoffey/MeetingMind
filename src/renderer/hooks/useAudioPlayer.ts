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
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
        audioRef.current = null;
      }
    };
  }, []);

  const load = useCallback((src: string) => {
    // Clean up previous audio element completely
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      cancelAnimationFrame(animRef.current);
    }

    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      console.log('Audio metadata loaded, duration:', audio.duration, 'src:', src);
      setState(prev => ({ ...prev, duration: audio.duration, currentTime: 0 }));
    });

    audio.addEventListener('canplay', () => {
      console.log('Audio can play:', src);
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

    audio.addEventListener('error', () => {
      console.error('Audio load error:', audio.error?.code, audio.error?.message, 'src:', src);
      setState(prev => ({ ...prev, isPlaying: false, duration: 0 }));
    });

    // Set src and explicitly trigger load
    audio.src = src;
    audio.load();
  }, [tick]);

  const play = useCallback(() => {
    audioRef.current?.play().catch(err => {
      console.error('Audio play failed:', err);
    });
  }, []);

  const pause = useCallback(() => { audioRef.current?.pause(); }, []);

  const toggle = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().catch(err => {
        console.error('Audio play failed:', err);
      });
    } else {
      audioRef.current.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    console.log('Seeking to:', time, 'duration:', audio.duration, 'readyState:', audio.readyState);
    // readyState must be >= HAVE_METADATA (1) to seek
    if (audio.readyState >= 1) {
      audio.currentTime = time;
      setState(prev => ({ ...prev, currentTime: time }));
      if (audio.paused) {
        audio.play().catch(err => {
          console.error('Audio play after seek failed:', err);
        });
      }
    } else {
      // Audio not ready yet — wait for it, then seek
      const onReady = () => {
        audio.removeEventListener('loadedmetadata', onReady);
        audio.currentTime = time;
        setState(prev => ({ ...prev, currentTime: time }));
        audio.play().catch(err => {
          console.error('Audio play after deferred seek failed:', err);
        });
      };
      audio.addEventListener('loadedmetadata', onReady);
    }
  }, []);

  const setRate = useCallback((rate: number) => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
    setState(prev => ({ ...prev, playbackRate: rate }));
  }, []);

  return [state, { play, pause, toggle, seek, setRate, load }];
}
