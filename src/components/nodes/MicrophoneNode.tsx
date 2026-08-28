import { Handle, Position, useReactFlow } from '@xyflow/react';
import { useState, useRef, useCallback } from 'react';
import { Mic, Square } from 'lucide-react';
import type { NodePropertiesProps } from './registry';
import { DEVICE_CARD, DEVICE_TITLE, resolveOrientation } from './schematic';

export function MicrophoneProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">Amplification (×)</label>
      <input type="number" step="10" min="1" max="1000" value={(node.data.amplification as number) ?? 100} onChange={e => updateData('amplification', parseInt(e.target.value) || 100)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
      <div className="text-[10px] text-gray-400 mt-1">Output voltage = mic × 0.05V × gain</div>
    </div>
  );
}

export function MicrophoneNode({ id, data }: any) {
  const { isVertical } = resolveOrientation(data.orientation);
  const [isRecording, setIsRecording] = useState(false);
  const [hasData, setHasData] = useState(!!data.pwlData);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const { setNodes } = useReactFlow();

  const gain = data.amplification ?? 100;

  const updateNodeData = useCallback((updates: Record<string, any>) => {
    setNodes(nds => nds.map(n =>
      n.id === id
        ? { ...n, data: { ...n.data, ...updates } }
        : n
    ));
  }, [id, setNodes]);

  const toggleRecord = async () => {
    if (isRecording) {
      if (mediaRecorder.current) {
        mediaRecorder.current.stop();
      }
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder.current = new MediaRecorder(stream);
        chunks.current = [];
        
        mediaRecorder.current.ondataavailable = (e) => {
          chunks.current.push(e.data);
        };
        
        mediaRecorder.current.onstop = async () => {
          const blob = new Blob(chunks.current, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          
          const rawData = audioBuffer.getChannelData(0);
          const sampleRate = audioBuffer.sampleRate;
          
          // Decimate to ~8kHz to keep PWL manageable, take all recorded audio
          const targetSampleRate = 8000;
          const decimationFactor = Math.max(1, Math.floor(sampleRate / targetSampleRate)); 
          const points: { t: number; v: number }[] = [];
          
          for (let i = 0; i < rawData.length; i += decimationFactor) {
            // Raw audio is -1..+1, scale by gain to produce output voltage
            // Default gain of 100 means ±1 raw → ±100 * 0.001V = ±0.1V base,
            // but we use raw * 0.001 * gain so gain=100 → ±0.1V
            // Actually simpler: raw electret mic is ~5-50mV peak. 
            // We'll store the raw normalized values and apply gain in spice.ts
            points.push({ t: i / sampleRate, v: rawData[i] });
          }
          
          // Stop all tracks to release mic
          stream.getTracks().forEach(track => track.stop());
          audioCtx.close();

          // Properly update node data through React Flow state
          updateNodeData({ pwlData: points });
          setHasData(true);
        };
        
        mediaRecorder.current.start();
        setIsRecording(true);
        
        // Auto stop after the simulation duration (capped at 5s)
        const recordMs = Math.min((data.simLength ?? 1.0) * 1000, 5000);
        setTimeout(() => {
           if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
              mediaRecorder.current.stop();
              setIsRecording(false);
           }
        }, recordMs);
      } catch (err) {
        console.error("Mic access denied", err);
      }
    }
  };

  return (
    <div className={`${DEVICE_CARD} px-1.5 py-1 w-16 flex flex-col items-center justify-center gap-0.5 relative`}>
      <button
        onClick={toggleRecord}
        className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-700 dark:bg-slate-600'}`}
      >
        {isRecording ? <Square size={11} /> : <Mic size={11} />}
      </button>
      <div className={DEVICE_TITLE}>
        Mic{hasData && <span className="text-emerald-600 dark:text-emerald-400"> ●</span>}
      </div>
      <div className="text-[7px] font-mono leading-none text-slate-400 dark:text-slate-500">{gain}×</div>
      {/* The signal lead leaves sideways and ground drops down, which is how
          these read on a horizontal rail. Vertical puts the signal on top and
          ground at the bottom, for a part drawn on end. */}
      <Handle type="target" position={isVertical ? Position.Top : Position.Right} id="out" className="w-3 h-3 bg-emerald-500" />
      <Handle type="source" position={isVertical ? Position.Top : Position.Right} id="out" className="w-3 h-3 bg-emerald-500" />
      <Handle type="source" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" style={isVertical ? { left: '50%' } : undefined} />
      <Handle type="target" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" style={isVertical ? { left: '50%' } : undefined} />
    </div>
  );
}
