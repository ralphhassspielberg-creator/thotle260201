

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GeneratedAudio, Script, SceneElement } from '../types';
import Button from './Button';

// A generic "GeneratedImage" type for use within this component
type GeneratedImage = { sceneIndex: number; imageUrl: string };

const PlayIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" /></svg>
);
const PauseIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>
);
const NextIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="m5.25 4.5 7.5 7.5-7.5 7.5m6-15 7.5 7.5-7.5 7.5" /></svg>
);
const PrevIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="m18.75 4.5-7.5 7.5 7.5 7.5m-6-15L5.25 12l7.5 7.5" /></svg>
);
const CloseIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
);

type StoryboardItem = (GeneratedImage | GeneratedAudio) & {
    sceneElement?: SceneElement;
};

interface PresentationPlayerProps {
    initialItems: (GeneratedImage | GeneratedAudio)[];
    script: Script;
    backgroundMusic: string[];
    onClose: () => void;
}

const PresentationPlayer: React.FC<PresentationPlayerProps> = ({ initialItems, script, backgroundMusic, onClose }) => {
    const storyboardItems: StoryboardItem[] = useMemo(() => {
        return initialItems
            .map(item => ({
                ...item,
                sceneElement: script.scene_elements[item.sceneIndex],
            }))
            .sort((a, b) => a.sceneIndex - b.sceneIndex);
    }, [initialItems, script]);

    const [currentIndex, setCurrentIndex] = useState(0);
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(true);
    const audioRef = useRef<HTMLAudioElement>(null);
    const musicAudioRef = useRef<HTMLAudioElement>(null);
    const imageTimeoutRef = useRef<number | null>(null);
    const [currentMusicIndex, setCurrentMusicIndex] = useState(0);

    // Effect to find the first image and set it as the starting background
    useEffect(() => {
        const firstImage = storyboardItems.find(item => 'imageUrl' in item) as GeneratedImage | undefined;
        if (firstImage) {
            setCurrentImage(firstImage.imageUrl);
        }
    }, [storyboardItems]);

    // Effect for background music
    useEffect(() => {
        const musicPlayer = musicAudioRef.current;
        if (musicPlayer && backgroundMusic.length > 0) {
            if (isPlaying) {
                if (musicPlayer.src !== backgroundMusic[currentMusicIndex]) {
                    musicPlayer.src = backgroundMusic[currentMusicIndex];
                }
                musicPlayer.volume = 0.15; // Quiet background music
                musicPlayer.play().catch(e => console.error("Background music playback failed:", e));
            } else {
                musicPlayer.pause();
            }
        }
    }, [backgroundMusic, currentMusicIndex, isPlaying]);

    // The core playback logic effect
    useEffect(() => {
        if (imageTimeoutRef.current) clearTimeout(imageTimeoutRef.current);

        if (!isPlaying || currentIndex >= storyboardItems.length) {
            if (currentIndex >= storyboardItems.length) setIsPlaying(false);
            return;
        }

        const currentItem = storyboardItems[currentIndex];
        
        if ('imageUrl' in currentItem) {
            setCurrentImage(currentItem.imageUrl);
        }

        if ('audioBlob' in currentItem) {
            const audioUrl = URL.createObjectURL(currentItem.audioBlob);
            if (audioRef.current) {
                audioRef.current.src = audioUrl;
                audioRef.current.play().catch(e => console.error("Audio playback failed:", e));
            }
        } else {
            imageTimeoutRef.current = window.setTimeout(() => {
                goToNext();
            }, 4000); // 4-second delay for image-only slides
        }

        return () => {
            if (imageTimeoutRef.current) clearTimeout(imageTimeoutRef.current);
            if (audioRef.current && audioRef.current.src) {
                URL.revokeObjectURL(audioRef.current.src);
            }
        };
    }, [currentIndex, isPlaying, storyboardItems]);
    
    const goToNext = () => {
        setCurrentIndex(prev => Math.min(prev + 1, storyboardItems.length));
    };

    const goToPrev = () => {
        setCurrentIndex(prev => Math.max(prev - 1, 0));
    };

    const playNextMusicTrack = () => {
        if (backgroundMusic.length > 0) {
            setCurrentMusicIndex(prevIndex => (prevIndex + 1) % backgroundMusic.length);
        }
    };

    const togglePlayPause = () => {
        setIsPlaying(prev => {
            const newIsPlaying = !prev;
            if (audioRef.current) {
                newIsPlaying ? audioRef.current.play().catch(e => console.error(e)) : audioRef.current.pause();
            }
            if (musicAudioRef.current) {
                newIsPlaying ? musicAudioRef.current.play().catch(e => console.error("music play failed", e)) : musicAudioRef.current.pause();
            }
            // If we are starting playback from the end, restart from the beginning.
            if (newIsPlaying && currentIndex >= storyboardItems.length) {
                setCurrentIndex(0);
            }
            return newIsPlaying;
        });
    };
    
    const currentItem = storyboardItems[currentIndex];
    let displayText = '', characterText = '';
    if (currentItem?.sceneElement) {
        if (currentItem.sceneElement.type === 'action') displayText = currentItem.sceneElement.content || '';
        else if (currentItem.sceneElement.type === 'dialogue_block') {
            characterText = currentItem.sceneElement.character.toUpperCase();
            displayText = currentItem.sceneElement.elements.find(e => e.type === 'dialogue')?.content || '';
        }
    }

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-lg flex flex-col items-center justify-center z-50 animate-fade-in p-4" role="dialog" aria-modal="true" aria-labelledby="player-title">
            <h2 id="player-title" className="sr-only">Story Slideshow Player</h2>
            <div className="relative w-full max-w-5xl aspect-video bg-black rounded-lg shadow-2xl overflow-hidden mb-4">
                {currentImage ? (
                    <img src={currentImage} alt="Storyboard Scene" className="w-full h-full object-contain transition-opacity duration-500" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500"><p>Loading Visual...</p></div>
                )}
                 <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/60 to-transparent p-4 sm:p-6 text-white pointer-events-none">
                    {characterText && <p className="font-bold text-lg sm:text-xl drop-shadow-md">{characterText}</p>}
                    <p className="text-base sm:text-lg drop-shadow-md">{displayText}</p>
                 </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 bg-slate-800/50 p-2 rounded-lg">
                <Button onClick={goToPrev} disabled={currentIndex === 0} className="bg-transparent hover:bg-sky-900/50 p-3" aria-label="Previous slide"><PrevIcon /></Button>
                <Button onClick={togglePlayPause} className="bg-sky-600 hover:bg-sky-700 w-20 p-3" aria-label={isPlaying ? "Pause" : "Play"}>
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </Button>
                <Button onClick={goToNext} disabled={currentIndex >= storyboardItems.length} className="bg-transparent hover:bg-sky-900/50 p-3" aria-label="Next slide"><NextIcon /></Button>
            </div>
             <Button onClick={onClose} className="absolute top-3 right-3 bg-slate-700/50 hover:bg-slate-600/50 rounded-full p-2" aria-label="Close player"><CloseIcon /></Button>
             <audio ref={audioRef} onEnded={goToNext} className="hidden" />
             <audio ref={musicAudioRef} onEnded={playNextMusicTrack} className="hidden" />
        </div>
    );
};

export default PresentationPlayer;