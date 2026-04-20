import { useState, useEffect, useRef } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";

export default function RecordingWaveform({ recordingUrl, callLog, callStartDate, onTimeUpdate }) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!recordingUrl || !containerRef.current) return;

    let ws = null;
    import("wavesurfer.js")
      .then((WaveSurfer) => {
        ws = WaveSurfer.default.create({
          container: containerRef.current,
          waveColor: "#4F46E5",
          progressColor: "#818CF8",
          cursorColor: "#3B82F6",
          height: 80,
          barWidth: 2,
          barGap: 1,
          responsive: true,
          splitChannels: true,
        });

        ws.on("ready", () => {
          setReady(true);
          setDuration(ws.getDuration());
        });

        ws.on("audioprocess", (time) => {
          setCurrentTime(time);
          onTimeUpdate?.(time);
        });

        ws.on("finish", () => setPlaying(false));
        ws.on("error", (err) => setError(err.message || "Failed to load recording"));

        ws.load(recordingUrl);
        wavesurferRef.current = ws;
      })
      .catch(() => setError("wavesurfer.js not available. Install it with: npm install wavesurfer.js"));

    return () => {
      ws?.destroy();
      wavesurferRef.current = null;
    };
  }, [recordingUrl]);

  const togglePlay = () => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.playPause();
    setPlaying(!playing);
  };

  const skip = (delta) => {
    if (!wavesurferRef.current) return;
    const newTime = Math.max(0, Math.min(duration, currentTime + delta));
    wavesurferRef.current.seekTo(newTime / duration);
  };

  const changeSpeed = (newSpeed) => {
    setSpeed(newSpeed);
    wavesurferRef.current?.setPlaybackRate(newSpeed);
  };

  if (!recordingUrl) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No recording available for this call</p>;
  }

  const formatTime = (t) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Waveform container */}
      <div ref={containerRef} className="bg-gray-100 dark:bg-gray-800 rounded-lg p-2 min-h-[80px]" />

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button onClick={() => skip(-5)} disabled={!ready} className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-40">
          <SkipBack size={16} />
        </button>
        <button onClick={togglePlay} disabled={!ready} className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full disabled:opacity-40">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={() => skip(5)} disabled={!ready} className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-40">
          <SkipForward size={16} />
        </button>

        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="flex gap-1 ml-auto">
          {[0.5, 1, 1.5, 2].map(s => (
            <button
              key={s}
              onClick={() => changeSpeed(s)}
              className={`px-2 py-0.5 text-xs rounded ${speed === s ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"}`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
