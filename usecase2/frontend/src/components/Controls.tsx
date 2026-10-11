// Accessible voice controls, VAD auto-capture, captions, haptic feedback cues, and M2-14 reversible adaptation prompt
// Exports default Controls component and ControlsProps
// Depends on react, ../audio, ../api, ../i18n, ../adapt, ../types

import React, { useState, useRef, useEffect } from 'react';
import {
  AudioRecorder,
  AudioMode,
  convertBlobToBase64,
  SentencePlaybackQueue,
  triggerHaptic,
  wavDurationMs,
} from '../audio';
import { SunoApiClient } from '../api';
import { Language } from '../i18n';
import { ReplySentenceMessage } from '../types';
import {
  AdaptationOffer,
  AdaptationType,
  AdaptationState,
  DEFAULT_ADAPTATION_STATE,
  applyAdaptation,
  revertAdaptation,
} from '../adapt';

export interface ControlsProps {
  apiClient: SunoApiClient;
  currentLang: Language;
  onStatusChange?: (statusText: string) => void;
  onCaptionChange?: (caption: string | null) => void;
  onAnnounce?: (message: string, priority?: 'polite' | 'assertive') => void;
  activeOffer?: AdaptationOffer | null;
  onAcceptOffer?: (adaptation: AdaptationType) => void;
  onDeclineOffer?: () => void;
  adaptationState?: AdaptationState;
  onRevertAdaptation?: (adaptation: AdaptationType) => void;
  onExplainSimplerToggle?: (active: boolean) => void;
}

export default function Controls({
  apiClient,
  currentLang,
  onStatusChange,
  onCaptionChange,
  onAnnounce,
  activeOffer: controlledOffer,
  onAcceptOffer,
  onDeclineOffer,
  adaptationState: controlledAdaptationState,
  onRevertAdaptation,
  onExplainSimplerToggle,
}: ControlsProps): React.ReactElement {
  const [mode, setMode] = useState<AudioMode>('push-to-talk');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready to listen');
  const [activeCaption, setActiveCaption] = useState<string | null>(null);
  const [recognizedText, setRecognizedText] = useState<string | null>(null);
  const [isExplainSimpler, setIsExplainSimpler] = useState<boolean>(false);

  // Adaptation state & offer management
  const [internalOffer, setInternalOffer] = useState<AdaptationOffer | null>(null);
  const [internalAdaptationState, setInternalAdaptationState] =
    useState<AdaptationState>(DEFAULT_ADAPTATION_STATE);

  const activeOffer = controlledOffer !== undefined ? controlledOffer : internalOffer;
  const currentAdaptationState =
    controlledAdaptationState !== undefined
      ? controlledAdaptationState
      : internalAdaptationState;

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
        setStatusMessage(msg.type === 'check_again'
          ? 'I could not hear that clearly. Please try again.'
          : `Voice service error (${msg.code}). Please try again.`);
      } else if (msg.type === 'asr.result') {
        setRecognizedText(msg.text.trim() || '(ASR returned an empty transcript)');
        setStatusMessage(msg.plausible ? 'Speech recognized.' : 'Speech detected, but the transcript was unclear.');
        const lower = msg.text.toLowerCase();
        if (
          lower.includes('explain simpler') ||
          lower.includes('simpler') ||
          lower.includes('samjhao asan') ||
          lower.includes('saralamga')
        ) {
          handleToggleExplainSimpler(true);
        }
      } else if (msg.type === 'adapt.offer') {
        // Capture incoming adaptation offer from server
        const offer: AdaptationOffer = {
          adaptation: msg.adaptation as AdaptationType,
          reason: msg.reason,
          triggerEvent: 'tap_miss',
          thresholdReached: 3,
          timestamp: Date.now(),
        };
        setInternalOffer(offer);
        onAnnounce?.(
          `Accessibility suggestion: ${msg.reason}. Tap Accept or Dismiss.`,
          'assertive'
        );
      }
    });

    return () => {
      unsubscribe();
      playbackQueueRef.current?.reset();
    };
  }, [apiClient, onCaptionChange, onAnnounce]);

  // Announce active offer when it appears
  useEffect(() => {
    if (activeOffer) {
      onAnnounce?.(
        `Accessibility proposal: ${activeOffer.reason}. Select Accept to apply, or Dismiss to keep standard settings.`,
        'assertive'
      );
    }
  }, [activeOffer, onAnnounce]);

  const handleAcceptOffer = () => {
    if (!activeOffer) return;
    const type = activeOffer.adaptation;

    if (onAcceptOffer) {
      onAcceptOffer(type);
    } else {
      setInternalAdaptationState((prev) => applyAdaptation(type, prev));
    }

    setInternalOffer(null);

    const confirmationMsg =
      type === 'larger_targets'
        ? 'Large target mode enabled. Buttons enlarged to 72px.'
        : type === 'slower_speech'
        ? 'Slower speech enabled. TTS playback slowed to 0.8x.'
        : 'Adaptation applied.';

    onAnnounce?.(
      `${confirmationMsg} This setting is always reversible using the Revert button above.`,
      'polite'
    );
  };

  const handleDeclineOffer = () => {
    if (onDeclineOffer) {
      onDeclineOffer();
    }
    setInternalOffer(null);
    onAnnounce?.('Suggestion dismissed. Keeping standard layout.', 'polite');
  };

  const handleRevert = (type: AdaptationType) => {
    if (onRevertAdaptation) {
      onRevertAdaptation(type);
    } else {
      setInternalAdaptationState((prev) => revertAdaptation(type, prev));
    }

    onAnnounce?.('Setting reverted to standard default.', 'polite');
  };

  const handleToggleExplainSimpler = (forcedState?: boolean) => {
    const nextState = forcedState !== undefined ? forcedState : !isExplainSimpler;
    setIsExplainSimpler(nextState);

    if (nextState) {
      playbackQueueRef.current?.setPlaybackRate(0.8);
      playbackQueueRef.current?.setExtraPause(300);
      apiClient.send({
        type: 'ui.event',
        kind: 'explain_again',
      });
      onAnnounce?.(
        'Explain Simpler mode activated. Speech playback slowed to 0.8x with longer pauses.',
        'polite'
      );
      setStatusMessage('Explain Simpler active (0.8x)');
      onExplainSimplerToggle?.(true);
    } else {
      const fallbackRate =
        currentAdaptationState.speechRate < 1.0 ? currentAdaptationState.speechRate : undefined;
      playbackQueueRef.current?.setPlaybackRate(fallbackRate);
      playbackQueueRef.current?.setExtraPause(0);
      onAnnounce?.(
        'Explain Simpler mode deactivated. Speech playback restored to standard speed.',
        'polite'
      );
      setStatusMessage('Standard speech rate');
      onExplainSimplerToggle?.(false);
    }
  };

  const dispatchUtterance = async (wavBlob: Blob) => {
    try {
      const base64Audio = await convertBlobToBase64(wavBlob);
      apiClient.send({
        type: 'audio.utterance',
        audio: base64Audio,
        audio_base64: base64Audio,
        content_type: 'audio/wav',
        sample_rate_hz: 16000,
        channels: 1,
        duration_ms: wavDurationMs(wavBlob),
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
      setRecognizedText(null);
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

  const isLargeTargets = currentAdaptationState.largeTargets;

  return (
    <section aria-label="Voice Controls" className="flex flex-col items-center gap-6 my-4 w-full max-w-2xl px-2">
      {/* 1. M2-14 Adaptation Consent Prompt Banner (Only shown when an offer is active) */}
      {activeOffer && (
        <div
          role="region"
          aria-labelledby="adaptation-prompt-title"
          className="w-full bg-brutal-surface border-4 border-coral-500 p-5 shadow-brutal text-left animate-fadeIn"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 bg-coral-500 inline-block" aria-hidden="true" />
            <h3
              id="adaptation-prompt-title"
              className="text-base sm:text-lg font-black font-mono uppercase tracking-tight text-white"
            >
              Accessibility Adaptation Suggestion
            </h3>
          </div>

          <p className="text-sm text-brutal-lightGrey font-sans mb-4 leading-relaxed">
            {activeOffer.reason}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleAcceptOffer}
              aria-label={`Accept suggestion to enable ${activeOffer.adaptation.replace('_', ' ')}`}
              className="min-h-[56px] px-6 py-3 bg-coral-500 hover:bg-coral-400 text-brutal-black font-mono font-black text-xs uppercase tracking-wider border-2 border-white shadow-brutalSm transition-all active:translate-x-0.5 active:translate-y-0.5"
            >
              Accept Adaptation
            </button>
            <button
              type="button"
              onClick={handleDeclineOffer}
              aria-label="Decline adaptation suggestion and keep standard layout"
              className="min-h-[56px] px-6 py-3 bg-brutal-card hover:bg-brutal-muted text-white font-mono font-bold text-xs uppercase tracking-wider border-2 border-brutal-border transition-all active:translate-x-0.5 active:translate-y-0.5"
            >
              Dismiss (Keep Standard)
            </button>
          </div>
        </div>
      )}

      {/* 2. Reversible Active Adaptation Badges */}
      {(currentAdaptationState.largeTargets || currentAdaptationState.speechRate < 1.0) && (
        <div className="flex flex-wrap items-center justify-center gap-2 w-full">
          {currentAdaptationState.largeTargets && (
            <div className="flex items-center gap-2 bg-brutal-card border-2 border-coral-500 px-3 py-1.5 shadow-brutalSm">
              <span className="text-xs font-mono font-bold uppercase text-coral-400">
                Large Targets (72px) Active
              </span>
              <button
                type="button"
                onClick={() => handleRevert('larger_targets')}
                aria-label="Revert large targets back to standard 56px size"
                className="text-[11px] font-mono font-bold uppercase underline text-white hover:text-coral-300 ml-1 p-1"
              >
                Revert
              </button>
            </div>
          )}

          {currentAdaptationState.speechRate < 1.0 && (
            <div className="flex items-center gap-2 bg-brutal-card border-2 border-coral-500 px-3 py-1.5 shadow-brutalSm">
              <span className="text-xs font-mono font-bold uppercase text-coral-400">
                Slower Speech (0.8x) Active
              </span>
              <button
                type="button"
                onClick={() => handleRevert('slower_speech')}
                aria-label="Revert speech rate back to standard 1.0x"
                className="text-[11px] font-mono font-bold uppercase underline text-white hover:text-coral-300 ml-1 p-1"
              >
                Revert
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3. High-Contrast Brutalist Caption Bar (Contrast Ratio 21:1, exceeds WCAG AAA 7:1) */}
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

      {recognizedText && (
        <aside className="w-full border-2 border-brutal-border bg-brutal-black p-4 text-left" aria-live="polite">
          <span className="block text-xs uppercase tracking-widest text-coral-400 font-mono font-black mb-1">
            You said
          </span>
          <p className="text-base font-medium text-white">{recognizedText}</p>
        </aside>
      )}

      {/* 4. Mode Selector Toggle */}
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
          className={`${
            isLargeTargets ? 'min-h-[64px] px-6 text-base' : 'min-h-[48px] px-4 text-sm'
          } font-mono font-bold tracking-tight transition-all focus:outline-none ${
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
          className={`${
            isLargeTargets ? 'min-h-[64px] px-6 text-base' : 'min-h-[48px] px-4 text-sm'
          } font-mono font-bold tracking-tight transition-all focus:outline-none ${
            mode === 'auto'
              ? 'bg-coral-500 text-brutal-black border-2 border-white shadow-brutalSm'
              : 'text-brutal-grey hover:text-white border-2 border-transparent'
          }`}
        >
          Auto VAD (Hands-Free)
        </button>
      </div>

      {/* 5. Explain Simpler Accessible Action (M2-15) */}
      <div className="w-full flex justify-center">
        <button
          type="button"
          onClick={() => handleToggleExplainSimpler()}
          aria-pressed={isExplainSimpler}
          aria-label={
            isExplainSimpler
              ? 'Explain Simpler active. Click to restore normal speech rate.'
              : 'Explain Simpler: slow down playback to 0.8x and add pauses.'
          }
          className={`${
            isLargeTargets ? 'min-h-[72px] px-8 text-base' : 'min-h-[56px] px-6 text-sm'
          } w-full sm:w-auto font-mono font-black uppercase tracking-wider flex items-center justify-center gap-2 border-2 transition-all shadow-brutalSm active:translate-x-0.5 active:translate-y-0.5 ${
            isExplainSimpler
              ? 'bg-coral-500 text-brutal-black border-white ring-2 ring-coral-400'
              : 'bg-brutal-card hover:bg-brutal-muted text-coral-400 border-coral-500/80'
          }`}
        >
          <span aria-hidden="true">{isExplainSimpler ? '💡' : '💬'}</span>
          <span>{isExplainSimpler ? 'Explain Simpler: ON (0.8x)' : 'Explain Simpler'}</span>
        </button>
      </div>

      {/* 6. Main Microphone Action Button (Scales to >= 72px in Large Targets Mode) */}
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
          className={`${
            isLargeTargets
              ? 'min-h-[72px] min-w-[72px] sm:min-h-[84px] sm:min-w-[84px] px-10 py-6 text-lg sm:text-2xl'
              : 'min-h-[56px] min-w-[56px] sm:min-h-[64px] sm:min-w-[64px] px-8 py-5 text-base sm:text-xl'
          } font-mono font-black flex items-center justify-center gap-3 transition-all duration-150 border-3 border-white shadow-brutal focus:outline-none active:translate-x-1 active:translate-y-1 active:shadow-none ${
            isRecording
              ? isSpeaking
                ? 'bg-white text-brutal-black ring-4 ring-coral-400 animate-pulse'
                : 'bg-brutal-black text-coral-500 border-coral-500 animate-pulse'
              : 'bg-coral-500 hover:bg-coral-400 text-brutal-black'
          }`}
        >
          <span aria-hidden="true" className={isLargeTargets ? 'text-3xl' : 'text-2xl'}>
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

      {/* 6. Status Feedback */}
      <p
        aria-live="polite"
        className="text-xs font-mono font-bold uppercase tracking-wider text-brutal-lightGrey bg-brutal-card border-2 border-brutal-border px-4 py-2 shadow-brutalSm"
      >
        {statusMessage}
      </p>
    </section>
  );
}
