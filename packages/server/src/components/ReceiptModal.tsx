import { useState, useEffect, useRef } from 'react'
import { Printer, Check, X } from 'lucide-react'

interface Plan {
  id: number
  name: string
  rate_type: string
  price: number
  duration_minutes: number
}

interface ReceiptModalProps {
  isOpen: boolean
  machine: any
  plans: Plan[]
  labName: string
  onClose: () => void
  onConfirm: (totalAmount: number, discount: number, paymentMethod: string) => void
}

export default function ReceiptModal({ isOpen, machine, plans, labName, onClose, onConfirm }: ReceiptModalProps) {
  const [subtotal, setSubtotal] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [total, setTotal] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('Cash')
  const [isPrintPreview, setIsPrintPreview] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && machine) {
      // Calculate billing subtotal
      let calculatedSubtotal = 0
      
      if (machine.plan_id) {
        const plan = plans.find(p => p.id === machine.plan_id)
        if (plan) {
          calculatedSubtotal = plan.price
        }
      } else {
        // Standard rate of $5.00/hour for custom or postpaid sessions
        const elapsedMinutes = (machine.timeRemaining || 0) / 60 // Wait, for postpaid timeRemaining = timeElapsed (seconds)
        const ratePerMinute = 5.00 / 60
        calculatedSubtotal = parseFloat((elapsedMinutes * ratePerMinute).toFixed(2))
      }
      
      setSubtotal(calculatedSubtotal)
      setDiscount(0)
      setTotal(calculatedSubtotal)
      setPaymentMethod('Cash')
      setIsPrintPreview(false)
    }
  }, [isOpen, machine, plans])

  if (!isOpen || !machine) return null

  const handleDiscountChange = (val: string) => {
    const disc = parseFloat(val) || 0
    setDiscount(disc)
    setTotal(Math.max(0, subtotal - disc))
  }

  const handleTotalChange = (val: string) => {
    const tot = parseFloat(val) || 0
    setTotal(tot)
    setDiscount(Math.max(0, subtotal - tot))
  }

  const handlePrint = () => {
    const printContent = printRef.current?.innerHTML
    if (printContent) {
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(`
          <html>
            <head>
              <title>Receipt - Machine ${machine.name}</title>
              <style>
                body { font-family: monospace; font-size: 12px; padding: 20px; text-align: center; }
                .divider { border-top: 1px dashed black; margin: 10px 0; }
                .flex-row { display: flex; justify-content: space-between; }
                .bold { font-weight: bold; }
                .header { font-size: 16px; margin-bottom: 5px; }
              </style>
            </head>
            <body>
              ${printContent}
              <script>window.print(); window.close();</script>
            </body>
          </html>
        `)
        win.document.close()
      }
    }
  }

  const elapsedSeconds = machine.mode === 'postpaid' ? machine.timeRemaining : (machine.timeElapsed || 0)
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const selectedPlan = plans.find(p => p.id === machine.plan_id)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
          <h3 className="text-xl font-bold text-white">
            {isPrintPreview ? 'Receipt Preview' : 'Close Session & Billing'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {isPrintPreview ? (
            /* Printable Receipt Layout */
            <div 
              ref={printRef} 
              className="bg-white text-black p-6 rounded-lg font-mono text-sm border border-slate-300 shadow-inner space-y-2 text-center"
            >
              <div className="text-lg font-bold uppercase tracking-wider">{labName}</div>
              <div className="text-xs text-slate-500">NetCafe Operator Receipt</div>
              <div className="border-t border-dashed border-slate-400 my-2" />
              
              <div className="text-left space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Machine:</span>
                  <span className="font-bold">{machine.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Customer:</span>
                  <span className="font-bold">{machine.user || 'Guest'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Mode:</span>
                  <span className="font-bold uppercase">{machine.mode || 'Postpaid'}</span>
                </div>
                {selectedPlan && (
                  <div className="flex justify-between">
                    <span>Plan:</span>
                    <span>{selectedPlan.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Time Used:</span>
                  <span>{formatTime(elapsedSeconds)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Date:</span>
                  <span>{new Date().toLocaleString()}</span>
                </div>
              </div>

              <div className="border-t border-dashed border-slate-400 my-2" />
              
              <div className="text-left space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Discount:</span>
                    <span>-${discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="border-t border-dashed border-slate-400/50 my-1" />
                <div className="flex justify-between font-bold text-sm">
                  <span>Total Due:</span>
                  <span>${total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Method:</span>
                  <span>{paymentMethod}</span>
                </div>
              </div>

              <div className="border-t border-dashed border-slate-400 my-2" />
              <div className="text-xs font-bold uppercase tracking-tight">Thank you for visiting!</div>
              <div className="text-[10px] text-slate-500">Powered by NetCafe Manager</div>
            </div>
          ) : (
            /* Editing Billing and Discounts */
            <div className="space-y-4">
              {/* Session Meta */}
              <div className="bg-slate-950/60 p-4 border border-slate-800/50 rounded-lg text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Machine:</span>
                  <span className="text-white font-bold">{machine.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Customer:</span>
                  <span className="text-slate-200 font-medium">{machine.user || 'Guest'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Billing Mode:</span>
                  <span className="text-slate-200 font-medium uppercase text-xs px-2 py-0.5 bg-slate-800 rounded">
                    {machine.mode || 'Postpaid'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Session Elapsed:</span>
                  <span className="text-white font-mono font-semibold">{formatTime(elapsedSeconds)}</span>
                </div>
              </div>

              {/* Billing Forms */}
              <div className="space-y-3">
                {/* Subtotal */}
                <div className="flex justify-between items-center bg-slate-950 px-3 py-2 border border-slate-900 rounded">
                  <span className="text-sm text-slate-400">Subtotal Amount</span>
                  <span className="text-base text-slate-200 font-bold">${subtotal.toFixed(2)}</span>
                </div>

                {/* Discount */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-300 block">Apply Discount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={subtotal}
                    value={discount || ''}
                    onChange={(e) => handleDiscountChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
                  />
                </div>

                {/* Final Total */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-300 block">Final Total Due ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={total || ''}
                    onChange={(e) => handleTotalChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none font-bold text-lg text-blue-400 transition-colors"
                  />
                </div>

                {/* Payment Method */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-300 block">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
                  >
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Card">Card</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-between gap-3">
          <div>
            {isPrintPreview ? (
              <button
                onClick={() => setIsPrintPreview(false)}
                className="px-4 py-2 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white rounded text-sm font-medium transition-colors"
              >
                Back to Edit
              </button>
            ) : (
              <button
                onClick={() => setIsPrintPreview(true)}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-sm font-medium transition-colors"
              >
                <Printer size={16} /> Receipt Preview
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {isPrintPreview && (
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors"
              >
                Print
              </button>
            )}
            <button
              onClick={() => onConfirm(total, discount, paymentMethod)}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition-colors"
            >
              <Check size={16} /> Complete & Lock
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
