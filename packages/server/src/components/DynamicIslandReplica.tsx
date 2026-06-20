import React, { useState, useEffect } from 'react'
import { 
  Play, Pause, SkipForward, SkipBack, Search, 
  Settings, Monitor, ArrowUpCircle, Cloud, Grip,
  Shuffle, Star, Image as ImageIcon, Video,
  Calendar, CheckSquare, MessageCircle
} from 'lucide-react'

export type IslandState = 'tray' | 'music' | 'file-dock' | 'imessage' | 'weather'

interface DynamicIslandReplicaProps {
  initialState?: IslandState
}

export const DynamicIslandReplica: React.FC<DynamicIslandReplicaProps> = ({
  initialState = 'tray'
}) => {
  const [currentState, setCurrentState] = useState<IslandState>(initialState)
  const [contentState, setContentState] = useState<IslandState>(initialState)

  useEffect(() => {
    const fadeInTimeout = setTimeout(() => {
      setContentState(currentState)
    }, 600)

    return () => clearTimeout(fadeInTimeout)
  }, [currentState])

  const getContainerStyle = () => {
    switch (currentState) {
      case 'tray':
        return { width: '580px', height: '110px', borderRadius: '32px' }
      case 'music':
        return { width: '340px', height: '140px', borderRadius: '32px' }
      case 'file-dock':
        return { width: '580px', height: '180px', borderRadius: '32px' }
      case 'imessage':
        return { width: '380px', height: '130px', borderRadius: '32px' }
      case 'weather':
        return { width: '420px', height: '160px', borderRadius: '32px' }
      default:
        return { width: '200px', height: '40px', borderRadius: '20px' }
    }
  }

  const isContentVisible = contentState === currentState

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-950 rounded-2xl border border-slate-900 shadow-2xl max-w-5xl mx-auto space-y-8">
      <div className="text-center space-y-1.5">
        <h2 className="text-lg font-bold text-white tracking-tight">Dynamic Island: Custom Designs</h2>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">High-fidelity UI recreations using Apple-style morphing transitions</p>
      </div>

      <div 
        className="relative w-[850px] h-[350px] rounded-xl overflow-hidden flex justify-center pt-0 border border-slate-800/80"
        style={{
          background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 30%, #8b5cf6 60%, #f43f5e 100%)',
        }}
      >
        {/* Fake macOS Menubar */}
        <div className="absolute top-0 inset-x-0 h-7 bg-white/10 backdrop-blur-md flex items-center justify-between px-4 text-[11px] font-medium text-white/90 shadow-sm z-0">
          <div className="flex gap-4">
            <span className="font-bold tracking-tight"></span>
            <span>Finder</span>
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
            <span>Go</span>
            <span>Window</span>
            <span>Help</span>
          </div>
          <div className="flex gap-4 items-center pr-[120px]">
            <span>100%</span>
            <span>Mon Aug 5 9:08 AM</span>
          </div>
        </div>

        {/* Dynamic Island Wrapper (Anchored top center over menubar) */}
        <div className="flex items-start gap-3 select-none pt-0 z-10 relative">
          <div
            style={{
              ...getContainerStyle(),
              transition: 'all 600ms linear(0, 0.402, 0.729, 0.949, 1.054, 1.077, 1.057, 1.025, 0.999, 0.988, 0.992, 0.998, 1)'
            }}
            className="bg-[#050505] text-white shadow-2xl overflow-hidden border border-white/5 flex items-center justify-center"
          >
            <div className={`w-full h-full relative transition-opacity duration-150 ${isContentVisible ? 'opacity-100' : 'opacity-0'}`}>
              
              {/* 1. TRAY STATE */}
              {contentState === 'tray' && (
                <div className="w-full h-full flex items-center justify-between px-5 pt-3 animate-in fade-in duration-200">
                  <div className="flex items-center gap-4 w-1/3">
                    <div className="flex gap-2 text-xs absolute top-3 left-4">
                      <span className="px-3 py-1 bg-[#1a1a1a] rounded-full flex items-center gap-1.5"><Star size={10}/> Nook</span>
                      <span className="px-3 py-1 bg-transparent hover:bg-[#1a1a1a] rounded-full flex items-center gap-1.5 transition-colors cursor-pointer text-white/60"><Grip size={10}/> Tray</span>
                    </div>
                    <div className="flex gap-3 items-center mt-5">
                      <div className="w-[50px] h-[50px] bg-slate-800 rounded-lg overflow-hidden shrink-0 relative">
                         <img src="https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=100&h=100&fit=crop" alt="Album" className="w-full h-full object-cover opacity-80" />
                         <div className="absolute bottom-1 right-1 w-4 h-4 bg-red-500 rounded-sm flex items-center justify-center"><Play size={8} fill="white"/></div>
                      </div>
                      <div className="flex flex-col text-left">
                        <span className="text-sm font-bold truncate w-24">Dibi Dibi Rek</span>
                        <span className="text-[10px] text-white/50 truncate w-24">Ismaël Lô</span>
                        <div className="flex items-center gap-3 mt-1.5 text-white/70">
                          <SkipBack size={12} fill="currentColor" />
                          <Pause size={12} fill="currentColor" />
                          <SkipForward size={12} fill="currentColor" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="w-1/3 flex flex-col items-center border-l border-white/10 pl-6 py-1 mt-5">
                     <div className="flex justify-between w-full text-[10px] text-white/40 font-semibold mb-1 uppercase px-1">
                       <span>F 02</span><span>S 03</span><span>S 04</span><span className="text-blue-400">MON 05</span><span>T 06</span><span>W 07</span><span>T 08</span>
                     </div>
                     <div className="flex flex-col items-center text-white/40 text-xs mt-2">
                       <CheckSquare size={14} className="mb-1 opacity-50" />
                       Nothing for today
                     </div>
                     <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] text-blue-500">
                        <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse shadow-[0_0_8px_2px_rgba(59,130,246,0.6)]"></div>
                     </div>
                  </div>

                  <div className="w-1/3 flex justify-end relative">
                     <div className="absolute -top-6 right-0 text-white/50 hover:text-white cursor-pointer"><Settings size={14} /></div>
                     <div className="w-[60px] h-[60px] bg-[#1a1a1a] rounded-full flex flex-col items-center justify-center mt-3 mr-2 cursor-pointer hover:bg-[#222] transition-colors border border-white/5">
                        <Monitor size={20} className="mb-0.5 text-white/80" />
                        <span className="text-[10px] text-white/60">Mirror</span>
                     </div>
                  </div>
                </div>
              )}

              {/* 2. MUSIC OVERLAY */}
              {contentState === 'music' && (
                <div className="w-full h-full flex flex-col justify-center px-4 pt-4 animate-in fade-in duration-200">
                   <div className="flex items-center justify-between mb-3">
                     <div className="flex items-center gap-3">
                       <img src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&h=100&fit=crop" className="w-[50px] h-[50px] rounded-lg object-cover shadow-sm" />
                       <div className="flex flex-col">
                         <span className="text-sm font-bold">Break My Heart</span>
                         <span className="text-xs text-white/60">Matt Hansen</span>
                       </div>
                     </div>
                     <div className="flex items-end gap-[2px] h-4 pr-1">
                        <div className="w-[2px] h-2 bg-white/40 animate-pulse rounded-t-sm"></div>
                        <div className="w-[2px] h-4 bg-white/70 animate-pulse rounded-t-sm" style={{animationDelay: '0.2s'}}></div>
                        <div className="w-[2px] h-3 bg-white/50 animate-pulse rounded-t-sm" style={{animationDelay: '0.4s'}}></div>
                        <div className="w-[2px] h-2 bg-white/40 animate-pulse rounded-t-sm" style={{animationDelay: '0.1s'}}></div>
                     </div>
                   </div>
                   <div className="flex items-center justify-between text-[10px] text-white/50 font-mono mb-2">
                     <span>1:24</span>
                     <div className="h-1.5 w-full mx-3 bg-white/10 rounded-full overflow-hidden">
                       <div className="h-full bg-white rounded-full w-[40%]"></div>
                     </div>
                     <span>2:58</span>
                   </div>
                   <div className="flex justify-between items-center px-2">
                     <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 cursor-pointer">
                        <Shuffle size={14} />
                     </div>
                     <div className="flex items-center gap-4">
                       <SkipBack size={18} fill="currentColor" className="text-white hover:text-white/80 cursor-pointer" />
                       <Pause size={24} fill="currentColor" className="text-white hover:text-white/80 cursor-pointer" />
                       <SkipForward size={18} fill="currentColor" className="text-white hover:text-white/80 cursor-pointer" />
                     </div>
                     <Star size={16} className="text-white/50 hover:text-white cursor-pointer" />
                   </div>
                </div>
              )}

              {/* 3. FILE DOCK */}
              {contentState === 'file-dock' && (
                <div className="w-full h-full flex flex-col pt-5 px-5 animate-in fade-in duration-200">
                  <div className="flex gap-2">
                     <div className="px-3 py-1.5 bg-[#1a1a1a] text-white rounded-full text-xs font-semibold flex items-center gap-1.5 cursor-pointer border border-white/5">
                        <div className="w-2 h-2 rounded-full bg-red-500"></div> DynaClip
                     </div>
                     <div className="px-3 py-1.5 bg-white text-black rounded-full text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                        <div className="w-2 h-2 rounded-full bg-purple-500"></div> Desktop
                     </div>
                     <div className="px-3 py-1 bg-[#1a1a1a] text-white/50 rounded-full text-lg cursor-pointer hover:text-white transition-colors flex items-center justify-center border border-white/5">
                       +
                     </div>
                  </div>
                  <div className="flex gap-4 mt-4 overflow-x-auto pb-2 scrollbar-none snap-x">
                     {[
                       { icon: <ImageIcon size={20} className="text-blue-400"/>, label: 'Shot 2...', type: 'PNG' },
                       { icon: <Video size={20} className="text-purple-400"/>, label: 'DynaClip...', type: 'MOV' },
                       { icon: <Video size={20} className="text-purple-400"/>, label: 'Screen Rec...', type: 'MOV' },
                       { icon: <ImageIcon size={20} className="text-blue-400"/>, label: 'Screenshot...', type: 'PNG' },
                       { icon: <ImageIcon size={20} className="text-blue-400"/>, label: 'Screenshot...', type: 'PNG' },
                     ].map((item, i) => (
                       <div key={i} className="flex flex-col items-center gap-2 snap-start group cursor-pointer shrink-0">
                         <div className="w-12 h-14 bg-white/5 border border-white/10 rounded-lg flex flex-col items-center justify-center relative overflow-hidden group-hover:bg-white/10 transition-colors">
                           {item.icon}
                           <span className="absolute bottom-0 inset-x-0 bg-black/50 text-[7px] text-center py-0.5 text-white/70 backdrop-blur-md">{item.type}</span>
                         </div>
                         <span className="text-[9px] text-white/60 truncate w-14 text-center">{item.label}</span>
                       </div>
                     ))}
                  </div>
                  <div className="flex items-center gap-3 mt-auto mb-4">
                     <div className="text-xs text-white/50 font-medium">~ Desktop</div>
                     <div className="flex-1 bg-[#1a1a1a] rounded-full flex items-center px-3 py-1.5 border border-white/5">
                        <Search size={12} className="text-white/40 mr-2" />
                        <input type="text" placeholder="Search" className="bg-transparent border-none outline-none text-xs text-white w-full placeholder:text-white/30" />
                     </div>
                     <div className="w-7 h-7 rounded-full bg-[#1a1a1a] border border-white/5 flex items-center justify-center cursor-pointer hover:bg-[#222]">
                       <Grip size={14} className="text-white/60" />
                     </div>
                  </div>
                </div>
              )}

              {/* 4. iMESSAGE */}
              {contentState === 'imessage' && (
                <div className="w-full h-full flex flex-col px-4 pt-6 pb-4 animate-in fade-in duration-200">
                  <div className="flex items-start justify-between w-full gap-4">
                     <div className="relative shrink-0">
                        <img src="https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=100&h=100&fit=crop" className="w-10 h-10 rounded-full border-2 border-transparent" />
                        <div className="absolute -bottom-1 -right-1 bg-[#34C759] border-2 border-black w-4 h-4 rounded-full flex items-center justify-center">
                          <MessageCircle size={8} className="text-white" fill="white" />
                        </div>
                     </div>
                     <div className="flex-1 pt-0.5">
                        <div className="flex justify-between items-end mb-2">
                           <span className="font-bold text-sm">Liam Pattreson</span>
                           <span className="text-[10px] text-white/40">now</span>
                        </div>
                        <div className="bg-[#1c1c1e] rounded-xl px-3 py-2 flex items-center gap-3 border border-white/5">
                           <Pause size={12} fill="white" className="text-white cursor-pointer" />
                           <div className="flex-1 flex gap-[2px] items-center h-3 opacity-60">
                             {Array.from({length: 25}).map((_, i) => (
                               <div key={i} className="w-[2px] bg-white rounded-full" style={{ height: `${Math.max(20, Math.random() * 100)}%`}}></div>
                             ))}
                           </div>
                           <span className="text-[10px] font-mono text-white/60">0:01</span>
                        </div>
                     </div>
                  </div>
                  <div className="mt-auto flex items-center w-full gap-2 relative">
                     <input type="text" placeholder="iMessage" className="w-full bg-[#1c1c1e] text-xs text-white rounded-full px-4 py-2 border border-white/5 outline-none placeholder:text-white/30" />
                     <div className="absolute right-1 top-1 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center cursor-pointer shadow-sm">
                       <ArrowUpCircle size={16} className="text-white" />
                     </div>
                  </div>
                </div>
              )}

              {/* 5. WEATHER & CALENDAR */}
              {contentState === 'weather' && (
                <div className="w-full h-full flex pt-8 px-6 animate-in fade-in duration-200">
                  <div className="absolute top-4 left-4"><Settings size={14} className="text-white/50 hover:text-white cursor-pointer"/></div>
                  
                  <div className="flex-1 flex flex-col items-center justify-center pr-4 border-r border-white/10 -mt-2">
                     <Cloud size={28} className="text-white mb-2" fill="white" />
                     <span className="text-xl font-medium tracking-tight mb-4">27°</span>
                     <span className="text-xs font-semibold text-white/90">Bengaluru</span>
                  </div>

                  <div className="flex-[1.5] flex flex-col items-center justify-center border-r border-white/10 -mt-2">
                     <span className="text-[32px] font-bold tracking-tighter leading-none mb-1">9:08 <span className="text-sm tracking-normal opacity-80">AM</span></span>
                     <span className="text-xs text-white/80 font-medium mb-4">Monday, 4 Aug</span>
                     <span className="text-xs font-semibold text-white/90">Overcast Clouds</span>
                  </div>

                  <div className="flex-[1.2] flex flex-col justify-center pl-6 -mt-2">
                     <div className="flex items-center gap-2 mb-3">
                       <span className="font-bold text-lg">Today</span>
                       <div className="bg-white/10 p-1 rounded-md"><Calendar size={12}/></div>
                     </div>
                     <div className="space-y-3 relative before:absolute before:left-[3px] before:top-2 before:bottom-2 before:w-[1px] before:bg-white/10">
                        <div className="relative pl-4 text-[9px] text-white/60 font-medium">
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-sm bg-blue-500"></div>
                          <div className="text-white/90 mb-0.5 w-12 h-1 bg-white/20 rounded-full"></div>
                          9:30 AM – 10:30 AM
                        </div>
                        <div className="relative pl-4 text-[9px] text-white/60 font-medium">
                          <div className="absolute left-[2px] top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-blue-500"></div>
                          <div className="flex gap-1 mb-0.5"><div className="w-4 h-1 bg-white/10 rounded-full"></div><div className="w-4 h-1 bg-white/10 rounded-full"></div></div>
                          11:30 AM – 12:30 PM
                        </div>
                        <div className="relative pl-4 text-[9px] text-white/60 font-medium">
                          <div className="absolute left-[2px] top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-blue-500"></div>
                          <div className="flex gap-1 mb-0.5"><div className="w-6 h-2 bg-white/10 rounded-sm"></div><div className="w-6 h-2 bg-white/30 rounded-sm"></div></div>
                          12:30 PM – 1:30 PM
                        </div>
                     </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      <div className="w-full space-y-3 pt-2 border-t border-slate-900">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block text-left">Trigger State</span>
        <div className="flex flex-wrap gap-2.5">
          {(['tray', 'music', 'file-dock', 'imessage', 'weather'] as IslandState[]).map(state => (
            <button
              key={state}
              onClick={() => setCurrentState(state)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${
                currentState === state
                  ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-slate-900 border-slate-850 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {state.charAt(0).toUpperCase() + state.slice(1).replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
