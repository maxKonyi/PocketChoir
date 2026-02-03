import { useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';

export function BackgroundVideo() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const backgroundVideo = useAppStore((state) => state.display.backgroundVideo);
    const backgroundBlur = useAppStore((state) => state.display.backgroundBlur);
    const backgroundBrightness = useAppStore((state) => state.display.backgroundBrightness);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.load();
        }
    }, [backgroundVideo]);

    if (backgroundVideo === 'none') return null;

    return (
        <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
            <video
                ref={videoRef}
                autoPlay
                loop
                muted
                playsInline
                className="absolute min-w-full min-h-full object-cover transition-all duration-1000"
                style={{ filter: `blur(${backgroundBlur}px) brightness(${backgroundBrightness})` }}
            >
                <source src={backgroundVideo} type="video/mp4" />
            </video>
            <div className="absolute inset-0 bg-black/30" />
        </div>
    );
}
