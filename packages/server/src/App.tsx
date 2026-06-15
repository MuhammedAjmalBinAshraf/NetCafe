import { useEffect, useState, useRef, type FormEvent } from 'react'
import {
  Monitor, Play, Pause, Square, Lock, MessageSquare, Power, ServerOff,
  ShieldAlert, KeyRound, LayoutDashboard, History, Settings as SettingsIcon,
  BarChart3, ShieldX, Plus, Edit, Trash2, Database, Download, RefreshCw, X, Eye,
  UserCircle2, RefreshCcw, ArrowDownToLine, CheckCircle, AlertTriangle, Loader2
} from 'lucide-react'
import SessionModal from './components/SessionModal'
import ReceiptModal from './components/ReceiptModal'

interface Plan {
  id: number
  name: string
  rate_type: string
  price: number
  duration_minutes: number
}

interface BlockRule {
  id: number
  type: string
  value: string
  mode: string
  is_active: boolean
}

interface User {
  id: number
  username: string
  display_name: string | null
  phone: string | null
  email: string | null
  balance_minutes: number
  created_at: string
}

export default function App() {
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [currentUser, setCurrentUser] = useState<any>(null)

  // Navigation & Data
  const [activeTab, setActiveTab] = useState<'dashboard' | 'sessions' | 'plans' | 'blocking' | 'reports' | 'settings' | 'users'>('dashboard')
  const [machines, setMachines] = useState<any[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [blockRules, setBlockRules] = useState<BlockRule[]>([])
  const [reportsData, setReportsData] = useState<any>({
    totalSessions: 0,
    totalRevenue: 0,
    avgDuration: 0,
    chartData: [],
    machineUsage: [],
    sessionsHistory: []
  })
  const [settings, setSettings] = useState<any>({ lab_name: 'NetCafe Manager' })

  // Modals & Drawers
  const [selectedMachine, setSelectedMachine] = useState<any>(null)
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false)
  const [selectedDrawerMachine, setSelectedDrawerMachine] = useState<any>(null)

  // Remote monitoring states
  const [screenshotBase64, setScreenshotBase64] = useState<string>('')
  const [screenshotLoading, setScreenshotLoading] = useState(false)
  const [screenshotError, setScreenshotError] = useState('')

  // Pricing plans CRUD states
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [planName, setPlanName] = useState('')
  const [planRateType, setPlanRateType] = useState('fixed')
  const [planPrice, setPlanPrice] = useState('')
  const [planDuration, setPlanDuration] = useState('')

  // Blocking rules CRUD states
  const [ruleType, setRuleType] = useState('domain')
  const [ruleValue, setRuleValue] = useState('')
  const [ruleMode, setRuleMode] = useState('block')

  // Global messages state
  const [globalMessage, setGlobalMessage] = useState('')
  const [isGlobalMessageOpen, setIsGlobalMessageOpen] = useState(false)

  // Auto-updater state
  const [updateStatus, setUpdateStatus] = useState<{ status: string; info?: any; progress?: any; message?: string } | null>(null)

  // User Management states
  const [users, setUsers] = useState<User[]>([])
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  
  // User Form fields
  const [userUsername, setUserUsername] = useState('')
  const [userPassword, setUserPassword] = useState('')
  const [userDisplayName, setUserDisplayName] = useState('')
  const [userPhone, setUserPhone] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userBalanceMinutes, setUserBalanceMinutes] = useState('0')
  const [userSearchQuery, setUserSearchQuery] = useState('')

  // Bulk add states
  const [isBulkUserModalOpen, setIsBulkUserModalOpen] = useState(false)
  const [bulkCsvText, setBulkCsvText] = useState('')

  // Top-Up states
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false)
  const [topUpUser, setTopUpUser] = useState<User | null>(null)
  const [topUpMinutes, setTopUpMinutes] = useState('60')

  // IPC listener registration guard
  const ipcBound = useRef(false)

  // Time remaining auto-ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setMachines((prevMachines) =>
        prevMachines.map((m) => {
          if (m.status === 'in_use' && m.timeRemaining > 0) {
            return { ...m, timeRemaining: m.timeRemaining - 1 }
          }
          return m
        })
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Sync IPC Handlers — bind ONCE on mount, clean up on unmount
  useEffect(() => {
    if (window.ipcRenderer && !ipcBound.current) {
      ipcBound.current = true

      // Load initial data
      window.ipcRenderer.invoke('get-machines').then(setMachines)
      window.ipcRenderer.invoke('get-plans').then(setPlans)
      window.ipcRenderer.invoke('get-block-rules').then(setBlockRules)
      window.ipcRenderer.invoke('get-settings').then(setSettings)
      window.ipcRenderer.invoke('get-users').then(setUsers)

      // Named listener so it can be removed on cleanup
      const machineListener = (_: any, data: any) => {
        setMachines(data)
        setSelectedDrawerMachine((prev: any) => {
          if (!prev) return prev
          const updated = data.find((m: any) => m.id === prev.id)
          return updated || prev
        })
      }
      window.ipcRenderer.on('machines-updated', machineListener)

      const updateListener = (_: any, payload: any) => {
        setUpdateStatus(payload)
      }
      window.ipcRenderer.on('update-status', updateListener)

      return () => {
        window.ipcRenderer?.off('machines-updated', machineListener)
        window.ipcRenderer?.off('update-status', updateListener)
        ipcBound.current = false
      }
    }
  }, [])

  // Load plans, rules, settings, reports on tab switches
  useEffect(() => {
    if (isAuthenticated && window.ipcRenderer) {
      if (activeTab === 'plans') {
        window.ipcRenderer.invoke('get-plans').then(setPlans)
      } else if (activeTab === 'blocking') {
        window.ipcRenderer.invoke('get-block-rules').then(setBlockRules)
      } else if (activeTab === 'reports' || activeTab === 'sessions') {
        window.ipcRenderer.invoke('get-reports-summary').then(setReportsData)
      } else if (activeTab === 'settings') {
        window.ipcRenderer.invoke('get-settings').then(setSettings)
      } else if (activeTab === 'users') {
        window.ipcRenderer.invoke('get-users').then(setUsers)
      }
    }
  }, [activeTab, isAuthenticated])

  // Auth handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    if (window.ipcRenderer) {
      const res = await window.ipcRenderer.invoke('login-staff', username, password)
      if (res.success) {
        setIsAuthenticated(true)
        setCurrentUser(res.user)
      } else {
        setAuthError(res.error)
      }
    } else {
      // Local dev fallback if not running inside Electron wrapper
      setIsAuthenticated(true)
      setCurrentUser({ username: 'admin', role: 'admin' })
    }
  }

  // User Management Actions
  const fetchUsers = () => {
    if (window.ipcRenderer) {
      window.ipcRenderer.invoke('get-users').then(setUsers)
    }
  }

  const handleOpenAddUser = () => {
    setEditingUser(null)
    setUserUsername('')
    setUserPassword('')
    setUserDisplayName('')
    setUserPhone('')
    setUserEmail('')
    setUserBalanceMinutes('0')
    setIsUserModalOpen(true)
  }

  const handleOpenEditUser = (user: User) => {
    setEditingUser(user)
    setUserUsername(user.username)
    setUserPassword('') // Keep blank unless updating
    setUserDisplayName(user.display_name || '')
    setUserPhone(user.phone || '')
    setUserEmail(user.email || '')
    setUserBalanceMinutes(user.balance_minutes.toString())
    setIsUserModalOpen(true)
  }

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!window.ipcRenderer) return
    const balance = parseInt(userBalanceMinutes) || 0
    if (editingUser) {
      const res = await window.ipcRenderer.invoke(
        'update-user',
        editingUser.id,
        userUsername,
        userPassword,
        userDisplayName,
        userPhone,
        userEmail,
        balance
      )
      if (res.success) {
        setIsUserModalOpen(false)
        fetchUsers()
      } else {
        alert('Error updating user: ' + res.error)
      }
    } else {
      if (!userPassword) {
        alert('Password is required for new users')
        return
      }
      const res = await window.ipcRenderer.invoke(
        'create-user',
        userUsername,
        userPassword,
        userDisplayName,
        userPhone,
        userEmail,
        balance
      )
      if (res.success) {
        setIsUserModalOpen(false)
        fetchUsers()
      } else {
        alert('Error creating user: ' + res.error)
      }
    }
  }

  const handleDeleteUser = async (id: number) => {
    if (!confirm('Are you sure you want to delete this user?')) return
    if (!window.ipcRenderer) return
    const res = await window.ipcRenderer.invoke('delete-user', id)
    if (res.success) {
      fetchUsers()
    } else {
      alert('Error deleting user: ' + res.error)
    }
  }

  const handleOpenTopUp = (user: User) => {
    setTopUpUser(user)
    setTopUpMinutes('60')
    setIsTopUpModalOpen(true)
  }

  const handleConfirmTopUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!topUpUser || !window.ipcRenderer) return
    const mins = parseInt(topUpMinutes) || 0
    if (mins <= 0) {
      alert('Please enter a valid number of minutes')
      return
    }
    const res = await window.ipcRenderer.invoke('topup-user', topUpUser.id, mins)
    if (res.success) {
      setIsTopUpModalOpen(false)
      fetchUsers()
    } else {
      alert('Error topping up balance: ' + res.error)
    }
  }

  const handleBulkAddUsers = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!window.ipcRenderer) return
    
    const lines = bulkCsvText.split('\n')
    const parsedUsers: any[] = []
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const parts = line.split(',')
      if (parts.length < 2) {
        alert(`Line ${i + 1} is invalid. Format must be: username,password,display_name,balance_minutes`)
        return
      }
      const uUsername = parts[0].trim()
      const uPassword = parts[1].trim()
      const uDisplayName = parts[2] ? parts[2].trim() : ''
      const uBalance = parts[3] ? parseInt(parts[3].trim()) || 0 : 0
      
      if (!uUsername || !uPassword) {
        alert(`Line ${i + 1} is missing username or password.`)
        return
      }
      parsedUsers.push({
        username: uUsername,
        password: uPassword,
        display_name: uDisplayName,
        balance_minutes: uBalance
      })
    }
    
    if (parsedUsers.length === 0) {
      alert('No user data to import.')
      return
    }
    
    const results = await window.ipcRenderer.invoke('bulk-create-users', parsedUsers)
    const successCount = results.filter((r: any) => r.success).length
    const failCount = results.length - successCount
    
    alert(`Import Complete!\nSuccessfully imported: ${successCount}\nFailed (or duplicates): ${failCount}`)
    setIsBulkUserModalOpen(false)
    setBulkCsvText('')
    fetchUsers()
  }

  // Machine controls
  const handleOpenClick = (machine: any) => {
    setSelectedMachine(machine)
    setIsSessionModalOpen(true)
  }

  const handleConfirmSession = async (customer: string, planId: number | null, mode: string, duration: number | null) => {
    setIsSessionModalOpen(false)
    if (window.ipcRenderer && selectedMachine) {
      await window.ipcRenderer.invoke('open-session', selectedMachine.id, customer, planId, mode, duration)
    }
  }

  const handleCloseClick = (machine: any) => {
    setSelectedMachine(machine)
    setIsReceiptModalOpen(true)
  }

  const handleConfirmClose = async (total: number, discount: number, paymentMethod: string) => {
    setIsReceiptModalOpen(false)
    if (window.ipcRenderer && selectedMachine) {
      await window.ipcRenderer.invoke('close-session', selectedMachine.id, total, discount, paymentMethod)
    }
  }

  const handlePause = async (machineId: number) => {
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke('pause-session', machineId)
    }
  }

  const handleResume = async (machineId: number) => {
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke('resume-session', machineId)
    }
  }

  const handleExtendClick = async (machineId: number) => {
    const minStr = prompt('Enter minutes to extend session:', '30')
    const mins = parseInt(minStr || '', 10)
    if (window.ipcRenderer && !isNaN(mins) && mins > 0) {
      const res = await window.ipcRenderer.invoke('extend-session', machineId, mins)
      if (!res.success) alert(res.error)
    }
  }


  const handleMsgClick = (machineId: number) => {
    const msg = prompt('Enter message to send client:')
    if (window.ipcRenderer && msg) {
      window.ipcRenderer.invoke('message-machine', machineId, msg)
    }
  }

  const handlePower = async (machineId: number) => {
    if (confirm('Are you sure you want to shutdown this machine?')) {
      if (window.ipcRenderer) await window.ipcRenderer.invoke('power-machine', machineId)
    }
  }

  const handleRestart = async (machineId: number) => {
    if (confirm('Are you sure you want to restart this machine?')) {
      if (window.ipcRenderer) await window.ipcRenderer.invoke('restart-machine', machineId)
    }
  }

  const handleLimitSpeed = async (machineId: number) => {
    const rate = prompt('Enter speed limit (e.g., 2mbit, 512kbit, 5mbit):', '2mbit')
    if (window.ipcRenderer && rate) {
      await window.ipcRenderer.invoke('limit-bandwidth', machineId, rate)
      alert(`Applied bandwidth limit of ${rate} to machine.`);
    }
  }

  const handleRemoveSpeed = async (machineId: number) => {
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke('remove-bandwidth', machineId)
      alert('Removed bandwidth limit from machine.')
    }
  }

  const handleRenameMachine = async (machine: any) => {
    const newName = prompt(`Rename terminal "${machine.name}":`, machine.name)
    if (!newName || newName.trim() === '') return
    if (!window.ipcRenderer) return
    const res = await window.ipcRenderer.invoke('rename-machine', machine.id, newName.trim())
    if (!res.success) alert('Error renaming: ' + res.error)
    else setSelectedDrawerMachine({ ...machine, name: newName.trim() })
  }

  const handleDeleteMachine = async (machineId: number) => {
    if (!confirm('Remove this terminal from the dashboard? This will delete its record from the database.')) return
    if (!window.ipcRenderer) return
    const res = await window.ipcRenderer.invoke('delete-machine', machineId)
    if (res.success) {
      setSelectedDrawerMachine(null)
    } else {
      alert('Error removing terminal: ' + res.error)
    }
  }

  // Global actions
  const handleLockAll = async () => {
    if (window.ipcRenderer) await window.ipcRenderer.invoke('lock-all')
  }

  const handlePowerAll = async () => {
    if (confirm('Shutdown ALL active client machines?')) {
      if (window.ipcRenderer) await window.ipcRenderer.invoke('power-all')
    }
  }

  const handleSendGlobalMessage = async () => {
    if (window.ipcRenderer && globalMessage) {
      await window.ipcRenderer.invoke('message-all', globalMessage)
      setGlobalMessage('')
      setIsGlobalMessageOpen(false)
    }
  }

  // Remote view screenshot capture
  const handleCaptureScreenshot = async (machineId: number) => {
    setScreenshotLoading(true)
    setScreenshotError('')
    setScreenshotBase64('')
    if (window.ipcRenderer) {
      try {
        const base64 = await window.ipcRenderer.invoke('capture-screenshot', machineId)
        setScreenshotBase64(base64)
      } catch (err: any) {
        setScreenshotError(err.message || 'Failed to capture screenshot')
      } finally {
        setScreenshotLoading(false)
      }
    } else {
      setScreenshotError('Not inside Electron wrapper')
      setScreenshotLoading(false)
    }
  }

  // Pricing plans CRUD
  const handleSavePlan = async (e: FormEvent) => {
    e.preventDefault()
    if (window.ipcRenderer) {
      const priceVal = parseFloat(planPrice) || 0
      const durVal = parseInt(planDuration, 10) || null
      if (editingPlan) {
        await window.ipcRenderer.invoke('update-plan', editingPlan.id, planName, planRateType, priceVal, durVal)
      } else {
        await window.ipcRenderer.invoke('create-plan', planName, planRateType, priceVal, durVal)
      }
      setIsPlanModalOpen(false)
      setEditingPlan(null)
      window.ipcRenderer.invoke('get-plans').then(setPlans)
    }
  }

  const handleDeletePlan = async (id: number) => {
    if (confirm('Are you sure you want to delete this plan?') && window.ipcRenderer) {
      await window.ipcRenderer.invoke('delete-plan', id)
      window.ipcRenderer.invoke('get-plans').then(setPlans)
    }
  }

  const openAddPlan = () => {
    setPlanName('')
    setPlanRateType('fixed')
    setPlanPrice('')
    setPlanDuration('')
    setEditingPlan(null)
    setIsPlanModalOpen(true)
  }

  const openEditPlan = (plan: Plan) => {
    setEditingPlan(plan)
    setPlanName(plan.name)
    setPlanRateType(plan.rate_type)
    setPlanPrice(plan.price.toString())
    setPlanDuration(plan.duration_minutes?.toString() || '')
    setIsPlanModalOpen(true)
  }

  // Blocking Rules CRUD
  const handleAddRule = async (e: FormEvent) => {
    e.preventDefault()
    if (window.ipcRenderer && ruleValue) {
      await window.ipcRenderer.invoke('add-block-rule', ruleType, ruleValue, ruleMode)
      setRuleValue('')
      window.ipcRenderer.invoke('get-block-rules').then(setBlockRules)
    }
  }

  const handleToggleRule = async (id: number, active: boolean) => {
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke('toggle-block-rule', id, active)
      window.ipcRenderer.invoke('get-block-rules').then(setBlockRules)
    }
  }

  const handleDeleteRule = async (id: number) => {
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke('delete-block-rule', id)
      window.ipcRenderer.invoke('get-block-rules').then(setBlockRules)
    }
  }

  // Settings updates
  const handleUpdateBranding = async (name: string) => {
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke('update-settings', 'lab_name', name)
      const fresh = await window.ipcRenderer.invoke('get-settings')
      setSettings(fresh)
    }
  }

  const handleBackup = async () => {
    if (window.ipcRenderer) {
      const res = await window.ipcRenderer.invoke('backup-db', 'C:/Users/Student/Desktop/netcafe_backup.db')
      if (res.success) alert('Database backup saved to Desktop!')
      else alert('Backup failed: ' + res.error)
    }
  }

  const handleRestore = async () => {
    if (confirm('This will overwrite current DB and restart. Proceed?') && window.ipcRenderer) {
      const res = await window.ipcRenderer.invoke('restore-db', 'C:/Users/Student/Desktop/netcafe_backup.db')
      if (res.success) alert('Database restored successfully!')
      else alert('Restore failed: ' + res.error)
    }
  }

  // Status mapping
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-emerald-500 text-emerald-400'
      case 'in_use': return 'bg-blue-500 text-blue-400'
      case 'paused': return 'bg-amber-500 text-amber-400'
      case 'offline': return 'bg-slate-500 text-slate-400'
      default: return 'bg-slate-500 text-slate-400'
    }
  }

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  if (!isAuthenticated) {
    /* Staff Authentication Page */
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 bg-blue-600/10 rounded-full text-blue-500 mb-2">
              <Monitor size={48} />
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">NetCafe Server</h1>
            <p className="text-slate-400 text-sm">Please sign in to access the administrator dashboard.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Username</label>
              <input
                type="text"
                required
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
              />
            </div>

            {authError && (
              <div className="flex items-center gap-2 text-xs bg-red-950/40 border border-red-800/50 p-3 rounded text-red-400">
                <ShieldAlert size={16} />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded transition-colors"
            >
              <KeyRound size={18} /> Sign In
            </button>
          </form>
        </div>
      </div>
    )
  }

  const filteredUsers = users.filter((u) => {
    const query = userSearchQuery.toLowerCase()
    return (
      u.username.toLowerCase().includes(query) ||
      (u.display_name && u.display_name.toLowerCase().includes(query)) ||
      (u.phone && u.phone.includes(query)) ||
      (u.email && u.email.toLowerCase().includes(query))
    )
  })

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* Top Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Monitor className="text-blue-500" size={32} />
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">{settings.lab_name}</h1>
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full" />
              <span>Operator: {currentUser?.username} ({currentUser?.role})</span>
            </div>
          </div>
        </div>

        {/* Global Controls & Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Update status badge */}
          {updateStatus && updateStatus.status === 'available' && (
            <button
              onClick={() => window.ipcRenderer?.invoke('download-update')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors animate-pulse"
            >
              <ArrowDownToLine size={13} /> Update Available — Download
            </button>
          )}
          {updateStatus && updateStatus.status === 'downloading' && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/60 text-blue-300 rounded text-xs font-semibold border border-blue-800/40">
              <Loader2 size={13} className="animate-spin" />
              Downloading {Math.round(updateStatus.progress?.percent ?? 0)}%
            </span>
          )}
          {updateStatus && updateStatus.status === 'downloaded' && (
            <button
              onClick={() => window.ipcRenderer?.invoke('quit-and-install')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors"
            >
              <CheckCircle size={13} /> Restart to Install Update
            </button>
          )}
          {updateStatus && updateStatus.status === 'error' && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/60 text-red-400 rounded text-xs font-semibold border border-red-900/30" title={updateStatus.message}>
              <AlertTriangle size={13} /> Update Error
            </span>
          )}
          <button
            onClick={() => setIsGlobalMessageOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-semibold transition-colors"
          >
            <MessageSquare size={14} /> Message All
          </button>
          <button
            onClick={handleLockAll}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-semibold transition-colors"
          >
            <Lock size={14} /> Lock All
          </button>
          <button
            onClick={handlePowerAll}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-950/60 hover:bg-red-900/40 text-red-400 rounded text-xs font-semibold transition-colors border border-red-900/30"
          >
            <Power size={14} /> Shutdown All
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Navigation Sidebar */}
        <nav className="w-64 bg-slate-900/40 border-r border-slate-900 p-4 space-y-1 flex flex-col justify-between hidden lg:flex">
          <div className="space-y-1">
            <button
              onClick={() => { setActiveTab('dashboard'); setSelectedDrawerMachine(null) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <LayoutDashboard size={18} /> Dashboard
            </button>
            <button
              onClick={() => { setActiveTab('sessions'); setSelectedDrawerMachine(null) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'sessions' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <History size={18} /> Sessions History
            </button>
            <button
              onClick={() => { setActiveTab('plans'); setSelectedDrawerMachine(null) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'plans' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <Plus size={18} /> Pricing Plans
            </button>
            <button
              onClick={() => { setActiveTab('blocking'); setSelectedDrawerMachine(null) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'blocking' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <ShieldX size={18} /> Website & Apps
            </button>
            <button
              onClick={() => { setActiveTab('reports'); setSelectedDrawerMachine(null) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'reports' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <BarChart3 size={18} /> Reports
            </button>
            <button
              onClick={() => { setActiveTab('users'); setSelectedDrawerMachine(null) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'users' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <UserCircle2 size={18} /> Users
            </button>
            <button
              onClick={() => { setActiveTab('settings'); setSelectedDrawerMachine(null) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'settings' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <SettingsIcon size={18} /> Settings
            </button>
          </div>

          <div className="p-3 bg-slate-950/40 rounded-lg text-xs text-slate-500 border border-slate-900/50 space-y-2">
            <div className="font-semibold text-slate-400">NetCafe Server v1.0.15</div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Database: Connected</span>
            </div>
            {updateStatus?.status === 'not-available' && (
              <div className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle size={11} /> Up to date
              </div>
            )}
            {updateStatus?.status === 'checking' && (
              <div className="flex items-center gap-1.5 text-slate-400">
                <Loader2 size={11} className="animate-spin" /> Checking...
              </div>
            )}
            <button
              onClick={() => {
                setUpdateStatus({ status: 'checking' })
                window.ipcRenderer?.invoke('check-for-updates')
              }}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold transition-colors"
            >
              <RefreshCcw size={11} /> Check for Updates
            </button>
          </div>
        </nav>

        {/* Workspace Panels */}
        <main className="flex-1 p-6 overflow-y-auto bg-slate-950 flex flex-col">
          
          {/* TAB: Dashboard */}
          {activeTab === 'dashboard' && (
            <div className="flex-1 flex flex-col">
              {machines.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                  <ServerOff size={64} className="mb-4 opacity-50 text-slate-600" />
                  <h2 className="text-2xl font-bold text-slate-400">No machines connected yet</h2>
                  <p className="mt-2 text-sm max-w-md text-center">
                    Client agents connected on the same LAN will register here automatically.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 flex-1 items-start">
                  {machines.map((machine) => (
                    <div 
                      key={machine.id} 
                      className={`bg-slate-900/60 border rounded-xl overflow-hidden hover:border-slate-700 transition-all flex flex-col shadow-lg ${
                        selectedDrawerMachine?.id === machine.id ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-slate-800/80'
                      }`}
                    >
                      {/* Header status bar */}
                      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/20">
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-bold text-white">{machine.name}</h2>
                          <button 
                            onClick={() => {
                              setSelectedDrawerMachine(machine)
                              setScreenshotBase64('')
                              setScreenshotError('')
                            }}
                            className="text-slate-500 hover:text-blue-400 transition-colors p-0.5 rounded"
                            title="Remote monitoring metrics"
                          >
                            <Eye size={16} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-bold tracking-tight text-slate-400">
                            {machine.status.replace('_', ' ')}
                          </span>
                          <div className={`w-2 h-2 rounded-full ${getStatusColor(machine.status).split(' ')[0]}`} />
                        </div>
                      </div>
                      
                      {/* Body session timers */}
                      <div className="p-6 flex-1 flex flex-col justify-center items-center text-center">
                        {machine.status === 'in_use' || machine.status === 'paused' ? (
                          <>
                            <div className="text-3xl font-mono font-bold tracking-widest text-white mb-1">
                              {formatTime(machine.timeRemaining || 0)}
                            </div>
                            <div className="text-xs text-slate-400">
                              User: <span className="text-blue-400 font-semibold">{machine.user || 'Guest'}</span>
                              <span className="mx-1.5">•</span>
                              Mode: <span className="uppercase text-slate-300 font-medium">{machine.mode || 'postpaid'}</span>
                            </div>
                          </>
                        ) : (
                          <div className="text-slate-500 font-medium text-sm my-3">
                            {machine.status === 'available' ? 'Available for session' : 'Machine Offline'}
                          </div>
                        )}
                      </div>

                      {/* Footer Actions */}
                      <div className="p-3 bg-slate-950/50 border-t border-slate-850 flex flex-wrap gap-2 justify-center">
                        {machine.status === 'available' && (
                          <button
                            onClick={() => handleOpenClick(machine)}
                            className="flex-1 flex justify-center items-center gap-1.5 py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-xs transition-colors"
                          >
                            <Play size={14} /> Open
                          </button>
                        )}
                        {machine.status === 'in_use' && (
                          <>
                            <button
                              onClick={() => handlePause(machine.id)}
                              className="flex-1 flex justify-center items-center gap-1.5 py-1.5 px-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/50 text-amber-400 rounded font-semibold text-xs transition-all"
                            >
                              <Pause size={14} /> Pause
                            </button>
                            <button
                              onClick={() => handleCloseClick(machine)}
                              className="flex-1 flex justify-center items-center gap-1.5 py-1.5 px-2 bg-red-600 hover:bg-red-500 text-white rounded font-medium text-xs transition-colors"
                            >
                              <Square size={14} /> Close
                            </button>
                          </>
                        )}
                        {machine.status === 'paused' && (
                          <>
                            <button
                              onClick={() => handleResume(machine.id)}
                              className="flex-1 flex justify-center items-center gap-1.5 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium text-xs transition-colors"
                            >
                              <Play size={14} /> Resume
                            </button>
                            <button
                              onClick={() => handleCloseClick(machine)}
                              className="flex-1 flex justify-center items-center gap-1.5 py-1.5 px-2 bg-red-600 hover:bg-red-500 text-white rounded font-medium text-xs transition-colors"
                            >
                              <Square size={14} /> Close
                            </button>
                          </>
                        )}

                        {machine.status !== 'offline' && (
                          <div className="w-full flex gap-1.5 mt-1 pt-1.5 border-t border-slate-800/40">
                            <button
                              onClick={() => handleExtendClick(machine.id)}
                              className="flex-1 py-1 px-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 rounded"
                            >
                              Extend
                            </button>
                            <button
                              onClick={() => handleMsgClick(machine.id)}
                              className="flex-1 py-1 px-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 rounded"
                            >
                              Message
                            </button>
                            <button
                              onClick={() => handleRestart(machine.id)}
                              className="flex-1 py-1 px-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 rounded"
                            >
                              Restart
                            </button>
                            <button
                              onClick={() => handlePower(machine.id)}
                              className="flex-1 py-1 px-1.5 bg-slate-800 hover:bg-red-900/40 border border-slate-800 hover:border-red-900/50 text-[10px] font-bold text-slate-400 hover:text-red-400 rounded"
                            >
                              Power
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: Sessions History */}
          {activeTab === 'sessions' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center pb-4 border-b border-slate-900">
                <h2 className="text-xl font-bold">Session logs & receipts</h2>
                <div className="text-sm text-slate-400">Total sessions recorded: {reportsData.sessionsHistory?.length || 0}</div>
              </div>
              <div className="bg-slate-900/40 border border-slate-900 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 border-b border-slate-900 text-xs uppercase tracking-wider font-semibold">
                      <th className="p-4">ID</th>
                      <th className="p-4">PC</th>
                      <th className="p-4">Customer</th>
                      <th className="p-4">Mode</th>
                      <th className="p-4">Start Time</th>
                      <th className="p-4">End Time</th>
                      <th className="p-4 text-right">Discount</th>
                      <th className="p-4 text-right">Amount</th>
                      <th className="p-4">Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900 text-slate-200">
                    {reportsData.sessionsHistory?.map((sess: any) => (
                      <tr key={sess.id} className="hover:bg-slate-900/30 transition-colors">
                        <td className="p-4 font-mono font-bold text-slate-400">#{sess.id}</td>
                        <td className="p-4 font-semibold text-white">{sess.machine_name || `PC-${sess.machine_id}`}</td>
                        <td className="p-4">{sess.customer_name}</td>
                        <td className="p-4"><span className="text-[10px] font-bold uppercase bg-slate-800 px-2 py-0.5 rounded text-slate-300">{sess.mode}</span></td>
                        <td className="p-4 font-mono text-xs">{sess.start_time}</td>
                        <td className="p-4 font-mono text-xs">{sess.end_time || <span className="text-blue-400 font-bold">Active</span>}</td>
                        <td className="p-4 text-right text-red-400 font-semibold">${(sess.discount || 0).toFixed(2)}</td>
                        <td className="p-4 text-right font-bold text-white">${(sess.total_amount || 0).toFixed(2)}</td>
                        <td className="p-4 text-xs font-semibold text-slate-300">{sess.payment_method || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: Pricing Plans */}
          {activeTab === 'plans' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center pb-4 border-b border-slate-900">
                <h2 className="text-xl font-bold">Manage pricing plans</h2>
                <button
                  onClick={openAddPlan}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-semibold transition-colors"
                >
                  <Plus size={16} /> Create Plan
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {plans.map((plan) => (
                  <div key={plan.id} className="bg-slate-900/40 border border-slate-900 rounded-xl p-6 flex flex-col justify-between hover:border-slate-800 transition-colors">
                    <div>
                      <h3 className="text-lg font-bold text-white mb-2">{plan.name}</h3>
                      <div className="space-y-2 text-sm text-slate-400">
                        <div className="flex justify-between">
                          <span>Billing Rate:</span>
                          <span className="text-white font-semibold capitalize">{plan.rate_type}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Price:</span>
                          <span className="text-emerald-400 font-bold text-base">${plan.price.toFixed(2)}</span>
                        </div>
                        {plan.duration_minutes && (
                          <div className="flex justify-between">
                            <span>Duration:</span>
                            <span className="text-white font-semibold">{plan.duration_minutes} Minutes</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 mt-6 pt-4 border-t border-slate-900">
                      <button
                        onClick={() => openEditPlan(plan)}
                        className="flex-1 flex justify-center items-center gap-1.5 py-1.5 bg-slate-850 hover:bg-slate-800 text-xs font-bold text-slate-300 rounded transition-colors"
                      >
                        <Edit size={14} /> Edit
                      </button>
                      <button
                        onClick={() => handleDeletePlan(plan.id)}
                        className="flex-1 flex justify-center items-center gap-1.5 py-1.5 bg-red-950/20 hover:bg-red-900/20 border border-red-900/20 text-xs font-bold text-red-400 rounded transition-colors"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: Blocking Rules */}
          {activeTab === 'blocking' && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-slate-900">
                <h2 className="text-xl font-bold">LAN Site & Application Blocking</h2>
                <p className="text-slate-400 text-sm mt-1">Restrict domains or app executables globally on client locking agents.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                {/* Form column */}
                <form onSubmit={handleAddRule} className="bg-slate-900/60 border border-slate-900 rounded-xl p-6 space-y-4">
                  <h3 className="text-md font-bold text-white mb-2">Add blocking rule</h3>
                  
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Rule Type</label>
                    <select
                      value={ruleType}
                      onChange={(e) => setRuleType(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
                    >
                      <option value="domain">Website Domain (Hosts file)</option>
                      <option value="executable">App Executable (Process killer)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Rule Value</label>
                    <input
                      type="text"
                      required
                      placeholder={ruleType === 'domain' ? 'facebook.com' : 'Steam.exe'}
                      value={ruleValue}
                      onChange={(e) => setRuleValue(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Enforcement Mode</label>
                    <select
                      value={ruleMode}
                      onChange={(e) => setRuleMode(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
                    >
                      <option value="block">BLOCK / Terminate</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-sm transition-colors"
                  >
                    <Plus size={16} /> Add Restrictive Rule
                  </button>
                </form>

                {/* Table column */}
                <div className="lg:col-span-2 bg-slate-900/40 border border-slate-900 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 border-b border-slate-900 text-xs uppercase tracking-wider font-semibold">
                        <th className="p-4">Type</th>
                        <th className="p-4">Value</th>
                        <th className="p-4">Mode</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900 text-slate-250">
                      {blockRules.map((rule) => (
                        <tr key={rule.id} className="hover:bg-slate-900/30 transition-colors">
                          <td className="p-4 capitalize font-semibold">{rule.type}</td>
                          <td className="p-4 font-mono text-xs text-white">{rule.value}</td>
                          <td className="p-4 text-xs font-semibold uppercase text-red-400">{rule.mode}</td>
                          <td className="p-4">
                            <button
                              onClick={() => handleToggleRule(rule.id, !rule.is_active)}
                              className={`text-xs px-2.5 py-0.5 rounded font-bold transition-all ${
                                rule.is_active 
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-900/50' 
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {rule.is_active ? 'Active' : 'Disabled'}
                            </button>
                          </td>
                          <td className="p-4 text-center">
                            <button
                              onClick={() => handleDeleteRule(rule.id)}
                              className="p-1 hover:text-red-400 transition-colors text-slate-500"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Reports */}
          {activeTab === 'reports' && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-slate-900">
                <h2 className="text-xl font-bold">Revenue & analytics</h2>
                <p className="text-slate-400 text-sm mt-1">Check today's revenue summaries and client performance insights.</p>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900/50 border border-slate-900 p-6 rounded-xl space-y-2">
                  <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Today's Sessions</div>
                  <div className="text-3xl font-extrabold text-white">{reportsData.totalSessions}</div>
                  <div className="text-[10px] text-slate-500">Total sessions successfully completed.</div>
                </div>
                <div className="bg-slate-900/50 border border-slate-900 p-6 rounded-xl space-y-2">
                  <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Revenue</div>
                  <div className="text-3xl font-extrabold text-emerald-400">${reportsData.totalRevenue.toFixed(2)}</div>
                  <div className="text-[10px] text-slate-500">Aggregated sales from all logs.</div>
                </div>
                <div className="bg-slate-900/50 border border-slate-900 p-6 rounded-xl space-y-2">
                  <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Avg Session Time</div>
                  <div className="text-3xl font-extrabold text-white">{reportsData.avgDuration} <span className="text-base font-normal text-slate-450">mins</span></div>
                  <div className="text-[10px] text-slate-500">Average customer session length.</div>
                </div>
              </div>

              {/* Machine usage rankings */}
              <div className="bg-slate-900/40 border border-slate-900 rounded-xl p-6 space-y-4">
                <h3 className="text-md font-bold text-white">Machine utilization</h3>
                <div className="space-y-3">
                  {reportsData.machineUsage?.map((mach: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-sm p-3 bg-slate-950/60 rounded border border-slate-900">
                      <div className="font-semibold text-white">{mach.name}</div>
                      <div className="flex gap-6 text-xs text-slate-400">
                        <div>Sessions: <span className="text-slate-200 font-semibold">{mach.sessions_count}</span></div>
                        <div>Revenue: <span className="text-emerald-400 font-bold">${mach.total_revenue.toFixed(2)}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: Settings */}
          {activeTab === 'settings' && (
            <div className="space-y-6 max-w-xl">
              <div className="pb-4 border-b border-slate-900">
                <h2 className="text-xl font-bold">Admin system settings</h2>
                <p className="text-slate-400 text-sm mt-1">Configure branding headers and database operations.</p>
              </div>

              <div className="space-y-6">
                {/* Branding setting */}
                <div className="bg-slate-900/50 border border-slate-900 p-6 rounded-xl space-y-4">
                  <h3 className="text-md font-bold text-white flex items-center gap-2">
                    <Monitor size={18} className="text-blue-500" /> Branding Configuration
                  </h3>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-slate-400">Cafe / Lab Name</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors"
                      value={settings.lab_name || ''}
                      onChange={(e) => handleUpdateBranding(e.target.value)}
                    />
                  </div>
                </div>

                {/* DB backups */}
                <div className="bg-slate-900/50 border border-slate-900 p-6 rounded-xl space-y-4">
                  <h3 className="text-md font-bold text-white flex items-center gap-2">
                    <Database size={18} className="text-blue-500" /> Database Utilities
                  </h3>
                  <p className="text-xs text-slate-400">
                    Back up your complete settings, pricing plans, client lists, and history reports to a database file.
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      onClick={handleBackup}
                      className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded text-sm font-semibold transition-colors"
                    >
                      <Download size={16} /> Backup to Desktop
                    </button>
                    <button
                      onClick={handleRestore}
                      className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded text-sm font-semibold transition-colors"
                    >
                      <RefreshCw size={16} /> Restore from Desktop
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Users */}
          {activeTab === 'users' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-slate-900">
                <div>
                  <h2 className="text-xl font-bold text-white">Manage User Accounts</h2>
                  <p className="text-slate-400 text-sm mt-1">Create and top up prepaid customer accounts.</p>
                </div>
                <div className="flex gap-2.5">
                  <button
                    onClick={() => setIsBulkUserModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 border border-slate-800 hover:bg-slate-900 text-slate-300 rounded text-sm font-semibold transition-colors"
                  >
                    <Download size={16} /> Bulk Import CSV
                  </button>
                  <button
                    onClick={handleOpenAddUser}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-semibold transition-colors"
                  >
                    <Plus size={16} /> Add User
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="flex items-center bg-slate-900/40 border border-slate-900 rounded-lg px-3 py-2 max-w-md">
                <input
                  type="text"
                  placeholder="Search users..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="bg-transparent border-none text-white outline-none w-full text-sm"
                />
                {userSearchQuery && (
                  <button onClick={() => setUserSearchQuery('')} className="text-slate-500 hover:text-slate-300 text-xs font-bold font-mono">
                    CLEAR
                  </button>
                )}
              </div>

              {/* Users Table */}
              <div className="bg-slate-900/20 border border-slate-900 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-900 bg-slate-950/40 text-slate-400 text-xs font-bold uppercase tracking-wider">
                        <th className="p-4">Username</th>
                        <th className="p-4">Display Name</th>
                        <th className="p-4">Balance</th>
                        <th className="p-4">Contact Details</th>
                        <th className="p-4">Created At</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900 text-sm text-slate-300">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-slate-500">
                            No users found.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => (
                          <tr key={user.id} className="hover:bg-slate-900/10 transition-colors">
                            <td className="p-4 font-bold text-white">{user.username}</td>
                            <td className="p-4">{user.display_name || <span className="text-slate-600 italic">—</span>}</td>
                            <td className="p-4">
                              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                user.balance_minutes > 0 ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-rose-950 text-rose-400 border border-rose-900'
                              }`}>
                                {user.balance_minutes} min
                              </span>
                            </td>
                            <td className="p-4 space-y-0.5 text-xs text-slate-400">
                              {user.phone && <div>📞 {user.phone}</div>}
                              {user.email && <div>✉️ {user.email}</div>}
                              {!user.phone && !user.email && <span className="text-slate-600 italic">—</span>}
                            </td>
                            <td className="p-4 text-xs text-slate-400">
                              {new Date(user.created_at).toLocaleDateString()}
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => handleOpenTopUp(user)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors"
                                  title="Top-up minutes"
                                >
                                  Top-Up
                                </button>
                                <button
                                  onClick={() => handleOpenEditUser(user)}
                                  className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                                  title="Edit account"
                                >
                                  <Edit size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(user.id)}
                                  className="p-1 bg-red-950/20 hover:bg-red-900/20 border border-red-900/20 text-red-400 rounded transition-colors"
                                  title="Delete account"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </main>

        {/* Remote monitoring Details Drawer (Sidebar) */}
        {selectedDrawerMachine && (
          <aside className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col overflow-y-auto">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/20">
              <h3 className="font-bold text-white text-md">Remote Info: {selectedDrawerMachine.name}</h3>
              <button 
                onClick={() => setSelectedDrawerMachine(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="p-4 space-y-5 flex-1">
              {/* Sys Info Stats */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">System metrics</div>
                
                <div className="bg-slate-950/50 rounded p-3 border border-slate-800/30 text-xs space-y-2 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status:</span>
                    <span className="font-bold uppercase text-white">{selectedDrawerMachine.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">IP Addr:</span>
                    <span className="text-white">{selectedDrawerMachine.metrics?.ip || selectedDrawerMachine.ip_address || 'Offline'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Platform:</span>
                    <span className="text-white">{selectedDrawerMachine.metrics?.os || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Uptime:</span>
                    <span className="text-white">
                      {selectedDrawerMachine.metrics?.uptime ? `${Math.round(selectedDrawerMachine.metrics.uptime / 60)}m` : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Resource meters */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Resource usage</div>
                <div className="space-y-2">
                  {/* CPU Meter */}
                  <div>
                    <div className="flex justify-between text-xs font-mono mb-1">
                      <span>CPU Load</span>
                      <span className="font-bold text-white">{selectedDrawerMachine.metrics?.cpu || 0}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-950 rounded overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 transition-all duration-500" 
                        style={{ width: `${selectedDrawerMachine.metrics?.cpu || 0}%` }}
                      />
                    </div>
                  </div>

                  {/* RAM Meter */}
                  <div>
                    <div className="flex justify-between text-xs font-mono mb-1">
                      <span>RAM Load</span>
                      <span className="font-bold text-white">{selectedDrawerMachine.metrics?.ram || 0}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-950 rounded overflow-hidden">
                      <div 
                        className="h-full bg-amber-500 transition-all duration-500" 
                        style={{ width: `${selectedDrawerMachine.metrics?.ram || 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Window */}
              {selectedDrawerMachine.status === 'in_use' && (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Process / Window</div>
                  <div className="bg-slate-950/60 p-3 rounded border border-slate-800 text-xs font-mono text-slate-200 truncate">
                    {selectedDrawerMachine.metrics?.activeWindow || 'No active window reported'}
                  </div>
                </div>
              )}

              {/* Live view / screenshot capture */}
              {selectedDrawerMachine.status !== 'offline' && (
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Live screenshot view</div>
                  
                  {screenshotBase64 ? (
                    <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950 shadow-inner">
                      <img 
                        src={`data:image/png;base64,${screenshotBase64}`} 
                        alt="Client Live View" 
                        className="w-full h-auto"
                      />
                    </div>
                  ) : (
                    <div className="h-32 border border-dashed border-slate-800/80 rounded-lg flex flex-col justify-center items-center text-center p-4 bg-slate-950/20">
                      {screenshotLoading ? (
                        <div className="text-slate-400 text-xs flex flex-col items-center gap-2">
                          <RefreshCw size={24} className="animate-spin text-blue-500" />
                          <span>Requesting screenshot from agent...</span>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 space-y-2">
                          {screenshotError && <div className="text-red-400 font-medium mb-1">{screenshotError}</div>}
                          <div>No live screenshot loaded.</div>
                        </div>
                      )}
                    </div>
                  )}

                  {!screenshotLoading && (
                    <button
                      onClick={() => handleCaptureScreenshot(selectedDrawerMachine.id)}
                      className="w-full flex items-center justify-center gap-2 py-1.5 bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded text-xs font-bold transition-all"
                    >
                      <RefreshCw size={12} /> Capture Live Screen
                    </button>
                  )}
                </div>
              )}

              {/* Bandwidth Control */}
              {selectedDrawerMachine.status !== 'offline' && (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Bandwidth Control</div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleLimitSpeed(selectedDrawerMachine.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-amber-900/30 hover:bg-amber-800/50 border border-amber-800/40 text-amber-300 hover:text-amber-200 rounded text-xs font-bold transition-all"
                    >
                      Limit Speed
                    </button>
                    <button
                      onClick={() => handleRemoveSpeed(selectedDrawerMachine.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-slate-300 hover:text-white rounded text-xs font-bold transition-all"
                    >
                      Remove Limit
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-600">Linux only: uses tc qdisc (iproute2). No-op on Windows.</p>
                </div>
              )}

              {/* Remote Actions */}
              {selectedDrawerMachine.status !== 'offline' && (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Remote Actions</div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRestart(selectedDrawerMachine.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-blue-900/30 hover:bg-blue-800/50 border border-blue-800/40 text-blue-300 hover:text-blue-200 rounded text-xs font-bold transition-all"
                    >
                      Restart
                    </button>
                    <button
                      onClick={() => handlePower(selectedDrawerMachine.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-red-900/30 hover:bg-red-800/50 border border-red-800/40 text-red-400 hover:text-red-300 rounded text-xs font-bold transition-all"
                    >
                      Shutdown
                    </button>
                  </div>
                </div>
              )}

              {/* Terminal Management */}
              <div className="space-y-2 pt-2 border-t border-slate-900/60">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Terminal Management</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRenameMachine(selectedDrawerMachine)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-slate-300 hover:text-white rounded text-xs font-bold transition-all"
                  >
                    <Edit size={12} /> Rename
                  </button>
                  <button
                    onClick={() => handleDeleteMachine(selectedDrawerMachine.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-red-950/20 hover:bg-red-900/30 border border-red-900/30 text-red-400 hover:text-red-300 rounded text-xs font-bold transition-all"
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
                <p className="text-[10px] text-slate-600">Remove clears stale/offline entries from the dashboard.</p>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Global message Modal Dialog */}
      {isGlobalMessageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <h3 className="text-md font-bold text-white">Broadcast text message</h3>
              <button onClick={() => setIsGlobalMessageOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              <textarea
                placeholder="Enter alert message to send to all online clients..."
                value={globalMessage}
                onChange={(e) => setGlobalMessage(e.target.value)}
                className="w-full h-24 bg-slate-950 border border-slate-800 focus:border-blue-500 rounded p-2 text-white outline-none resize-none text-sm transition-colors"
              />
            </div>
            <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setIsGlobalMessageOpen(false)}
                className="px-3 py-1.5 border border-slate-800 hover:bg-slate-800 text-slate-400 rounded text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSendGlobalMessage}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded text-xs transition-colors"
              >
                Send Message
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pricing plan Modals Dialog */}
      {isPlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form onSubmit={handleSavePlan} className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <h3 className="text-md font-bold text-white">
                {editingPlan ? 'Edit Pricing Plan' : 'Create Pricing Plan'}
              </h3>
              <button type="button" onClick={() => setIsPlanModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Plan Name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. 1 Hour Special"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Billing Type</label>
                <select
                  value={planRateType}
                  onChange={(e) => setPlanRateType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                >
                  <option value="fixed">Fixed Duration (Prepaid)</option>
                  <option value="hourly">Hourly Rate (Postpaid)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="5.00"
                  value={planPrice}
                  onChange={(e) => setPlanPrice(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                />
              </div>

              {planRateType === 'fixed' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Duration (Minutes)</label>
                  <input
                    type="number"
                    required
                    placeholder="60"
                    value={planDuration}
                    onChange={(e) => setPlanDuration(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                  />
                </div>
              )}
            </div>
            <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsPlanModalOpen(false)}
                className="px-3 py-1.5 border border-slate-800 hover:bg-slate-800 text-slate-400 rounded text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded text-xs transition-colors"
              >
                Save Plan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Session lifecycle Modal dialogs */}
      <SessionModal
        isOpen={isSessionModalOpen}
        machineName={selectedMachine?.name || ''}
        plans={plans}
        onClose={() => setIsSessionModalOpen(false)}
        onConfirm={handleConfirmSession}
      />

      <ReceiptModal
        isOpen={isReceiptModalOpen}
        machine={selectedMachine}
        plans={plans}
        labName={settings.lab_name}
        onClose={() => setIsReceiptModalOpen(false)}
        onConfirm={handleConfirmClose}
      />

      {/* User Create/Edit Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form onSubmit={handleSaveUser} className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <h3 className="text-md font-bold text-white">
                {editingUser ? 'Edit User Account' : 'Create User Account'}
              </h3>
              <button type="button" onClick={() => setIsUserModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Username *</label>
                  <input
                    type="text"
                    required
                    placeholder="john_doe"
                    value={userUsername}
                    onChange={(e) => setUserUsername(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Password {editingUser ? '(leave blank to keep)' : '*'}
                  </label>
                  <input
                    type="password"
                    required={!editingUser}
                    placeholder="••••••••"
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Display Name</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={userDisplayName}
                  onChange={(e) => setUserDisplayName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Phone</label>
                  <input
                    type="text"
                    placeholder="555-0199"
                    value={userPhone}
                    onChange={(e) => setUserPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Email</label>
                  <input
                    type="email"
                    placeholder="john@example.com"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Initial Balance (Minutes)</label>
                <input
                  type="number"
                  required
                  placeholder="0"
                  value={userBalanceMinutes}
                  onChange={(e) => setUserBalanceMinutes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                />
              </div>
            </div>
            <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsUserModalOpen(false)}
                className="px-3 py-1.5 border border-slate-800 hover:bg-slate-800 text-slate-400 rounded text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded text-xs transition-colors"
              >
                Save User
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk Import Modal */}
      {isBulkUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form onSubmit={handleBulkAddUsers} className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <h3 className="text-md font-bold text-white">Bulk Import User Accounts</h3>
              <button type="button" onClick={() => setIsBulkUserModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 bg-slate-950/80 rounded border border-blue-900/30 text-xs text-slate-400 space-y-2">
                <p className="font-bold text-blue-400">CSV Import Instructions:</p>
                <p>Provide user details in comma-separated values (CSV) format. One user account per line.</p>
                <div className="font-mono bg-slate-950 p-2 rounded text-[10px] text-slate-300">
                  username,password,display_name,balance_minutes
                </div>
                <p className="text-amber-400/80">Example:<br />john_doe,pass123,John Doe,120<br />jane_smith,pass456,Jane Smith,60</p>
                <p className="text-slate-500">Note: Password and Username are required. Duplicates will be ignored.</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">CSV Input Data</label>
                <textarea
                  required
                  rows={8}
                  placeholder="username,password,display_name,balance_minutes"
                  value={bulkCsvText}
                  onChange={(e) => setBulkCsvText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none text-sm font-mono transition-colors resize-none"
                />
              </div>
            </div>
            <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsBulkUserModalOpen(false)}
                className="px-3 py-1.5 border border-slate-800 hover:bg-slate-800 text-slate-400 rounded text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded text-xs transition-colors"
              >
                Import Accounts
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Top-up Balance Modal */}
      {isTopUpModalOpen && topUpUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form onSubmit={handleConfirmTopUp} className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <h3 className="text-md font-bold text-white">Top-up User Balance</h3>
              <button type="button" onClick={() => setIsTopUpModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-950/50 p-3.5 rounded border border-slate-900 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">User:</span>
                  <span className="font-bold text-white">{topUpUser.display_name || topUpUser.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Current Balance:</span>
                  <span className="font-bold text-emerald-400">{topUpUser.balance_minutes} minutes</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Add Minutes</label>
                <input
                  type="number"
                  required
                  min="1"
                  placeholder="60"
                  value={topUpMinutes}
                  onChange={(e) => setTopUpMinutes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-1.5 text-white outline-none text-sm transition-colors"
                />
              </div>

              {/* Quick Presets */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Quick Presets</label>
                <div className="grid grid-cols-4 gap-2">
                  {[30, 60, 120, 300].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTopUpMinutes(preset.toString())}
                      className="py-1 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-xs font-semibold transition-colors"
                    >
                      +{preset}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsTopUpModalOpen(false)}
                className="px-3 py-1.5 border border-slate-800 hover:bg-slate-800 text-slate-400 rounded text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded text-xs transition-colors"
              >
                Confirm Top-Up
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
