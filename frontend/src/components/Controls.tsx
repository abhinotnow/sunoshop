// Accessible voice controls, VAD auto-capture, captions, and haptic feedback cues
// Exports default Controls component and ControlsProps
// Depends on react, ../audio, ../api, ../i18n

import React, { useState, useRef, useEffect } from 'react';
import {
  AudioRecorder,
  AudioMode,
  convertBlobToBase64,
  SentencePlaybackQueue,
  triggerHaptic,
} from '../audio';
import { SunoApiClient } from '../api';
import { Language } from '../i18n';
import { ReplySentenceMessage } from '../types';

export interface ControlsProps {
  apiClient: SunoApiClient;
  currentLang: Language;
  onStatusChange?: (statusText: string) => void;
  onCaptionChange?: (caption: string | null) => void;
}

export default function Controls({
  apiClient,
  currentLang,
  onStatusChange,
  onCaptionChange,
}: ControlsProps): React.ReactElement {
  const [mode, setMode] = useState<AudioMode>('push-to-talk');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready to listen');
  const [activeCaption, setActiveCaption] = useState<string | null>(null);

  const recorderRef = useRef<AudioRecorder>(new AudioRecorder());
  const playbackQueueRef = useRef<SentencePlaybackQueue | null>(null);

  // Initialize ordered playback queue and server message listeners
  useEffect(() => {
    playbackQueueRef.current = new SentencePlaybackQueue({
      onSentenceStart: (sentence: ReplySentenceMessage) => {
        setActiveCaption(sentence.text);
        onCaptionChange?.(sentence.text);
      },
      onSentenceEnd: () => {
        // Keeps sentence until next or empty
      },
      onQueueEmpty: () => {
        // Clear active caption after playback finishes
        setTimeout(() => {
          setActiveCaption(null);
          onCaptionChange?.(null);
        }, 1500);
      },
    });

    const unsubscribe = apiClient.onMessage((msg) => {
      if (msg.type === 'reply.sentence') {
        playbackQueueRef.current?.enqueue(msg);
      } else if (msg.type === 'reply.done') {
        triggerHaptic('success');
      } else if (msg.type === 'check_again' || msg.type === 'error') {
        triggerHaptic('error');
      }
    });

    return () => {
      unsubscribe();
      playbackQueueRef.current?.reset();
    };
  }, [apiClient, onCaptionChange]);

  const dispatchUtterance = async (wavBlob: Blob) => {
    try {
      const base64Audio = await convertBlobToBase64(wavBlob);
      apiClient.send({
        type: 'audio.utterance',
        audio: base64Audio,
        lang: currentLang,
      });
      setStatusMessage('Query sent. Awaiting response.');
      onStatusChange?.('Query sent');
    } catch (err) {
      console.error('Error sending audio utterance:', err);
      setStatusMessage('Failed to send audio');
      triggerHaptic('error');
    }
  };

  const handleStart = async () => {
    try {
      triggerHaptic('listening');
      playbackQueueRef.current?.reset();
      setActiveCaption(null);
      setIsRecording(true);
      setIsSpeaking(false);

      if (mode === 'auto') {
        setStatusMessage('Hands-free mode active. Listening for speech...');
        onStatusChange?.('Hands-free listening...');

        await recorderRef.current.start({
          mode: 'auto',
          onSpeechStart: () => {
            setIsSpeaking(true);
            setStatusMessage('Speech detected! Recording utterance...');
            onStatusChange?.('Speaking...');
          },
          onSpeechEnd: async (wavBlob) => {
            setIsRecording(false);
            setIsSpeaking(false);
            setStatusMessage('Silence detected. Processing utterance...');
            await dispatchUtterance(wavBlob);
          },
          onAutoStop: async (wavBlob) => {
            setIsRecording(false);
            setIsSpeaking(false);
            setStatusMessage('Recording capped at 20s. Processing...');
            await dispatchUtterance(wavBlob);
          },
        });
      } else {
        // Push-to-talk mode
        setStatusMessage('Listening (push-to-talk, max 20s)...');
        onStatusChange?.('Listening...');

        await recorderRef.current.start({
          mode: 'push-to-talk',
          onAutoStop: async (wavBlob) => {
            setIsRecording(false);
            setIsSpeaking(false);
            setStatusMessage('20s cap reached. Processing...');
            await dispatchUtterance(wavBlob);
          },
        });
      }
    } catch (err) {
      console.error('Audio capture error:', err);
      setIsRecording(false);
      setIsSpeaking(false);
      setStatusMessage('Microphone access denied or unavailable');
      onStatusChange?.('Microphone error');
      triggerHaptic('error');
    }
  };

  const handleStop = async () => {
    if (!recorderRef.current.recording) return;
    setIsRecording(false);
    setIsSpeaking(false);
    setStatusMessage('Stopping recording & transcribing...');
    onStatusChange?.('Processing...');

    try {
      const wavBlob = await recorderRef.current.stop();
      if (wavBlob) {
        await dispatchUtterance(wavBlob);
      }
    } catch (err) {
      console.error('Error stopping recorder:', err);
      setStatusMessage('Failed to encode audio');
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      handleStop();
    } else {
      handleStart();
    }
  };

  return (
    <section aria-label="Voice Controls" className="flex flex-col items-center gap-6 my-4 w-full max-w-2xl px-2">
      {/* High-Contrast Brutalist Caption Bar (Contrast Ratio 21:1, exceeds WCAG AAA 7:1) */}
      {activeCaption && (
        <aside
          id="live-caption-bar"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="w-full bg-brutal-black text-white border-4 border-coral-500 p-5 shadow-brutal text-center"
        >
          <span className="text-xs uppercase tracking-widest text-coral-400 font-mono font-black block mb-1">
            [ LIVE CAPTION ]
          </span>
          <p className="text-lg sm:text-2xl font-black font-mono leading-relaxed text-white">
            {activeCaption}
          </p>
        </aside>
      )}

      {/* Mode Selector Toggle */}
      <div
        role="group"
        aria-label="Recording Mode"
        className="flex items-center gap-2 bg-brutal-card border-2 border-brutal-border p-1.5 shadow-brutalSm"
      >
        <button
          type="button"
          onClick={() => {
            if (isRecording) handleStop();
            setMode('push-to-talk');
          }}
          aria-pressed={mode === 'push-to-talk'}
          className={`min-h-[48px] px-4 py-2 text-sm font-mono font-bold tracking-tight transition-all focus:outline-none ${
            mode === 'push-to-talk'
              ? 'bg-coral-500 text-brutal-black border-2 border-white shadow-brutalSm'
              : 'text-brutal-grey hover:text-white border-2 border-transparent'
          }`}
        >
          Push-to-Talk
        </button>
        <button
          type="button"
          onClick={() => {
            if (isRecording) handleStop();
            setMode('auto');
          }}
          aria-pressed={mode === 'auto'}
          className={`min-h-[48px] px-4 py-2 text-sm font-mono font-bold tracking-tight transition-all focus:outline-none ${
            mode === 'auto'
              ? 'bg-coral-500 text-brutal-black border-2 border-white shadow-brutalSm'
              : 'text-brutal-grey hover:text-white border-2 border-transparent'
          }`}
        >
          Auto VAD (Hands-Free)
        </button>
      </div>

      {/* Main Microphone Action Button */}
      <div className="relative my-2">
        <button
          type="button"
          onClick={toggleRecording}
          aria-pressed={isRecording}
          aria-label={
            isRecording
              ? mode === 'auto'
                ? 'Stop hands-free voice detection'
                : 'Stop recording voice query'
              : mode === 'auto'
              ? 'Start hands-free voice detection'
              : 'Start recording voice query'
          }
          className={`min-h-[56px] min-w-[56px] sm:min-h-[64px] sm:min-w-[64px] px-8 py-5 font-mono font-black text-base sm:text-xl flex items-center justify-center gap-3 transition-all duration-150 border-3 border-white shadow-brutal focus:outline-none active:translate-x-1 active:translate-y-1 active:shadow-none ${
            isRecording
              ? isSpeaking
                ? 'bg-white text-brutal-black ring-4 ring-coral-400 animate-pulse'
                : 'bg-brutal-black text-coral-500 border-coral-500 animate-pulse'
              : 'bg-coral-500 hover:bg-coral-400 text-brutal-black'
          }`}
        >
          <span aria-hidden="true" className="text-2xl">
            {isRecording ? (isSpeaking ? '🗣️' : '⏹') : '🎤'}
          </span>
          <span className="uppercase tracking-wider">
            {isRecording
              ? mode === 'auto'
                ? isSpeaking
                  ? 'Speaking (VAD)...'
                  : 'Listening for speech...'
                : 'Stop Recording'
              : mode === 'auto'
              ? 'Start Auto Listening'
              : 'Push to Talk'}
          </span>
        </button>
      </div>

      {/* Status feedback */}
      <p
        aria-live="polite"
        className="text-xs font-mono font-bold uppercase tracking-wider text-brutal-lightGrey bg-brutal-card border-2 border-brutal-border px-4 py-2 shadow-brutalSm"
      >
        {statusMessage}
      </p>
    </section>
  );
}
