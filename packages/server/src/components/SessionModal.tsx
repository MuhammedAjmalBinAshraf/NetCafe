import { useState, useEffect } from 'react'
import { Play, X } from 'lucide-react'

interface Plan {
  id: number
  name: string
  rate_type: string
  price: number
  duration_minutes: number
}

interface SessionModalProps {
  isOpen: boolean
  machineName: string
  plans: Plan[]
  onClose: () => void
  onConfirm: (customerName: string, planId: number | null, mode: string, customDuration: number | null) => void
}

export default function SessionModal({ isOpen, machineName, plans, onClose, onConfirm }: SessionModalProps) {
  const [customerName, setCustomerName] = useState('')
  const [mode, setMode] = useState<'prepaid' | 'postpaid'>('postpaid')
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null)
  const [customDuration, setCustomDuration] = useState<string>('')

  useEffect(() => {
    if (isOpen) {
      setCustomerName('')
      setMode('postpaid')
      setSelectedPlanId(null)
      setCustomDuration('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleStart = () => {
    const planId = mode === 'prepaid' ? selectedPlanId : null
    const duration = (mode === 'prepaid' && !planId) ? parseInt(customDuration, 10) : null
    onConfirm(customerName, planId, mode, duration)
  }

  const selectedPlan = plans.find(p => p.id === selectedPlanId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
          <h3 className="text-xl font-bold text-white">Open Session - {machineName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5 flex-1 overflow-y-auto">
          {/* Customer Name */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-300 block">Customer Name (Optional)</label>
            <input
              type="text"
              placeholder="Walk-in Guest"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
            />
          </div>

          {/* Mode Selection */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-300 block">Billing Mode</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('postpaid')}
                className={`py-2 px-3 rounded font-medium border text-sm transition-all ${
                  mode === 'postpaid'
                    ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Postpaid (Pay Later)
              </button>
              <button
                type="button"
                onClick={() => setMode('prepaid')}
                className={`py-2 px-3 rounded font-medium border text-sm transition-all ${
                  mode === 'prepaid'
                    ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Prepaid (Pay Now)
              </button>
            </div>
          </div>

          {/* Mode specific settings */}
          {mode === 'prepaid' ? (
            <div className="space-y-4 pt-2 border-t border-slate-800/50">
              {/* Select Plan */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300 block">Select Pricing Plan</label>
                <select
                  value={selectedPlanId || ''}
                  onChange={(e) => {
                    const val = e.target.value
                    setSelectedPlanId(val ? parseInt(val, 10) : null)
                    if (val) setCustomDuration('')
                  }}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
                >
                  <option value="">-- Custom Duration --</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} ({plan.duration_minutes}m) - ${plan.price.toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom Duration if no plan selected */}
              {!selectedPlanId && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-300 block">Custom Duration (Minutes)</label>
                  <input
                    type="number"
                    placeholder="Enter minutes, e.g. 30"
                    value={customDuration}
                    onChange={(e) => setCustomDuration(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
                  />
                </div>
              )}

              {/* Estimate summary */}
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/30 text-xs text-slate-400 space-y-1">
                <div className="flex justify-between">
                  <span>Session Length:</span>
                  <span className="text-slate-200 font-semibold">
                    {selectedPlanId ? `${selectedPlan?.duration_minutes} Minutes` : customDuration ? `${customDuration} Minutes` : '0 Minutes'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Price:</span>
                  <span className="text-blue-400 font-bold text-sm">
                    {selectedPlanId ? `$${selectedPlan?.price.toFixed(2)}` : '$0.00 (Standard rate applies)'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800/30 text-center text-xs text-slate-400">
              Session counts up. Charges will be calculated at session close based on elapsed time.
            </div>
          )}
        </div>

        <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white rounded text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={mode === 'prepaid' && !selectedPlanId && !customDuration}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800/40 disabled:text-slate-500 text-white rounded text-sm font-medium transition-colors"
          >
            <Play size={16} /> Start Session
          </button>
        </div>
      </div>
    </div>
  )
}
