import React, { useState, useEffect, useRef } from 'react'
import { Play, Pause, SkipForward, Battery, Volume2, Bell } from 'lucide-react'

// Dynamic Island states enum/type
export type IslandState = 'compact' | 'split' | 'banner' | 'overlay'

interface DynamicIslandReplicaProps {
  initialState?: IslandState
}

export const DynamicIslandReplica: React.FC<DynamicIslandReplicaProps> = ({
  initialState = 'compact'
}) => {
  const [currentState, setCurrentState] = useState<IslandState>(initialState)
  // Inner state to manage actual displayed content (for delayed fade-in/fade-out sequencing)
  const [contentState, setContentState] = useState<IslandState>(initialState)
  const [isMusicPlaying, setIsMusicPlaying] = useState(false)
  const autoDismissTimer = useRef<any>(null)

  // Track state transitions to implement precise content fade sequencing
  useEffect(() => {
    // If switching to a temporary alert state (banner), start auto-dismissal after exactly 2.5 seconds
    if (currentState === 'banner') {
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current)
      autoDismissTimer.current = setTimeout(() => {
        setCurrentState('compact')
      }, 2500)
    }

    // Phase 1: Fade out of old content happens immediately because isContentVisible becomes false (contentState !== currentState)
    // Phase 2: Morph transition starts immediately on the container
    // Phase 3: Wait 600ms (morphing time) before setting contentState to fade in the new content
    const fadeInTimeout = setTimeout(() => {
      setContentState(currentState)
    }, 600)

    return () => {
      clearTimeout(fadeInTimeout)
      if (autoDismissTimer.current && currentState !== 'banner') {
        clearTimeout(autoDismissTimer.current)
      }
    }
  }, [currentState])

  // Helpers to check dimensions for different states
  const getContainerStyle = () => {
    switch (currentState) {
      case 'split':
        return {
          width: '125px',
          height: '37px',
          borderRadius: '20px',
        }
      case 'banner':
        return {
          width: '320px',
          height: '45px',
          borderRadius: '22px',
        }
      case 'overlay':
        return {
          width: '350px',
          height: '200px',
          borderRadius: '32px',
        }
      case 'compact':
      default:
        return {
          width: '125px',
          height: '37px',
          borderRadius: '20px',
        }
    }
  }

  // Determine if content should be visible (only when container matches content state)
  const isContentVisible = contentState === currentState

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-950 rounded-2xl border border-slate-900 shadow-2xl max-w-lg mx-auto space-y-8">
      <div className="text-center space-y-1.5">
        <h2 className="text-lg font-bold text-white tracking-tight">Dynamic Island Sandbox</h2>
        <p className="text-xs text-slate-500 max-w-xs">Physics-based spring morphing and content fade sequencing</p>
      </div>

      {/* Viewport container mimicking top-center phone bezel */}
      <div className="relative w-full h-[280px] bg-slate-900/60 rounded-xl overflow-hidden flex justify-center pt-5 border border-slate-800/80">
        <div className="absolute top-0 inset-x-0 h-1.5 bg-black/40 blur-xs"></div>
        
        {/* Apple Dynamic Island Wrapper */}
        <div className="flex items-center gap-3 select-none">
          {/* Main Morphing Island Capsule */}
          <div
            style={{
              ...getContainerStyle(),
              transition: 'all 600ms linear(0, 0.402, 0.729, 0.949, 1.054, 1.077, 1.057, 1.025, 0.999, 0.988, 0.992, 0.998, 1)'
            }}
            className="bg-black text-white shadow-2xl overflow-hidden border border-white/10 flex items-center justify-center z-10"
          >
            {/* Inner Content Grid with Opacity Sequencer */}
            <div
              className={`w-full h-full flex items-center px-3.5 transition-opacity duration-150 ${
                isContentVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {/* COMPACT STATE */}
              {contentState === 'compact' && (
                <div className="w-full flex items-center justify-between text-xs font-semibold px-0.5 animate-in fade-in duration-200">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    <span className="text-emerald-400 font-mono tracking-tighter">98%</span>
                  </div>
                  <Volume2 size={13} className="text-slate-400" />
                </div>
              )}

              {/* SPLIT STATE (Left capsule content) */}
              {contentState === 'split' && (
                <div className="w-full flex items-center justify-center animate-in fade-in duration-200">
                  <div className="flex items-center gap-1">
                    <div className="w-1 h-3 bg-blue-450 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-1 h-4 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-1 h-2 bg-blue-455 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
                  </div>
                </div>
              )}

              {/* EXPANDED HORIZONTAL BANNER STATE */}
              {contentState === 'banner' && (
                <div className="w-full flex items-center justify-between gap-3 text-xs animate-in fade-in duration-200">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-amber-500/10 border border-amber-500/25 rounded-full flex items-center justify-center text-amber-400">
                      <Bell size={12} />
                    </div>
                    <div className="text-left leading-tight">
                      <div className="font-bold text-white text-[11px]">Silent Mode</div>
                      <div className="text-[10px] text-slate-400 font-medium">On</div>
                    </div>
                  </div>
                  <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-slate-300 font-bold uppercase tracking-wider">Muted</span>
                </div>
              )}

              {/* EXPANDED LARGE OVERLAY STATE */}
              {contentState === 'overlay' && (
                <div className="w-full flex flex-col justify-between py-3 h-full animate-in fade-in duration-200">
                  {/* Card Header info */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center shadow-inner relative overflow-hidden group border border-white/5">
                        <span className="absolute inset-0 bg-gradient-to-tr from-purple-600/30 to-blue-600/30"></span>
                        <Volume2 size={18} className="text-white z-10" />
                      </div>
                      <div className="text-left">
                        <h4 className="text-xs font-bold text-white tracking-wide truncate max-w-[150px]">Gemini Echoes</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5 font-medium truncate max-w-[150px]">Advanced Agentic Coding</p>
                      </div>
                    </div>
                    
                    {/* Ringing Visualizer */}
                    <div className="flex items-end gap-1 h-5 pr-1">
                      <span className="w-1 bg-emerald-500 rounded-t-xs" style={{ height: '60%', animation: 'pulse 1.2s infinite' }}></span>
                      <span className="w-1 bg-emerald-400 rounded-t-xs" style={{ height: '100%', animation: 'pulse 0.8s infinite' }}></span>
                      <span className="w-1 bg-emerald-500 rounded-t-xs" style={{ height: '40%', animation: 'pulse 1s infinite' }}></span>
                    </div>
                  </div>

                  {/* Playback Progress Scrubber */}
                  <div className="space-y-1 mt-2">
                    <div className="h-1 bg-white/10 rounded-full w-full overflow-hidden">
                      <div className="h-full bg-emerald-400 rounded-full w-2/5 animate-pulse"></div>
                    </div>
                    <div className="flex justify-between text-[8px] text-slate-500 font-mono">
                      <span>1:48</span>
                      <span>-3:12</span>
                    </div>
                  </div>

                  {/* Media Controls */}
                  <div className="flex items-center justify-center gap-6 mt-1">
                    <button className="text-slate-450 hover:text-white transition-colors">
                      <SkipForward size={14} className="rotate-180" />
                    </button>
                    <button 
                      onClick={() => setIsMusicPlaying(!isMusicPlaying)}
                      className="w-8 h-8 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
                    >
                      {isMusicPlaying ? <Pause size={14} fill="black" /> : <Play size={14} fill="black" className="translate-x-0.5" />}
                    </button>
                    <button className="text-slate-450 hover:text-white transition-colors">
                      <SkipForward size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Detached Split Pill (Only visible in 'split' state) */}
          <div
            style={{
              transition: 'all 600ms linear(0, 0.402, 0.729, 0.949, 1.054, 1.077, 1.057, 1.025, 0.999, 0.988, 0.992, 0.998, 1)'
            }}
            className={`bg-black border border-white/10 shadow-2xl rounded-full flex items-center justify-center z-10 ${
              currentState === 'split'
                ? 'w-[37px] h-[37px] opacity-100 scale-100'
                : 'w-0 h-0 opacity-0 scale-50 pointer-events-none'
            }`}
          >
            <div className={`transition-opacity duration-150 ${isContentVisible ? 'opacity-100' : 'opacity-0'}`}>
              <Battery size={13} className="text-emerald-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Sandbox Controller Buttons */}
      <div className="w-full space-y-3 pt-2 border-t border-slate-900">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block text-left">Control Panel</span>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => setCurrentState('compact')}
            className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
              currentState === 'compact'
                ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                : 'bg-slate-900 border-slate-850 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Compact (Default)
          </button>
          <button
            onClick={() => setCurrentState('split')}
            className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
              currentState === 'split'
                ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                : 'bg-slate-900 border-slate-850 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Minimal / Split
          </button>
          <button
            onClick={() => setCurrentState('banner')}
            className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
              currentState === 'banner'
                ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                : 'bg-slate-900 border-slate-850 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Expanded Banner
          </button>
          <button
            onClick={() => setCurrentState('overlay')}
            className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
              currentState === 'overlay'
                ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                : 'bg-slate-900 border-slate-850 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Large Overlay
          </button>
        </div>
      </div>
    </div>
  )
}
