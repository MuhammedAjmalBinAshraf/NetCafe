import { useEffect, useState, useRef, type FormEvent } from 'react'
import {
  Monitor, Play, Pause, Square, Lock, MessageSquare, Power, ServerOff,
  ShieldAlert, KeyRound, LayoutDashboard, History, Settings as SettingsIcon,
  BarChart3, ShieldX, Plus, Edit, Trash2, Database, Download, RefreshCw, X,
  UserCircle2, RefreshCcw, ArrowDownToLine, CheckCircle, AlertTriangle, Loader2, Menu,
  Maximize2, Minimize2, Terminal, Activity, FileSpreadsheet, Upload, Smartphone, QrCode,
  ChevronDown, ChevronUp, Eye, EyeOff
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
  password?: string
  display_name: string | null
  phone: string | null
  email: string | null
  balance_minutes: number
  created_at: string
}

export default function App() {
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('netcafe_auth') === 'true';
  })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('netcafe_user');
    try {
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })

  // Navigation & Data
  const [activeTab, setActiveTab] = useState<'dashboard' | 'sessions' | 'plans' | 'blocking' | 'safety' | 'reports' | 'settings' | 'users'>('dashboard')
  const [machines, setMachines] = useState<any[]>([])
  const [dashboardView, setDashboardView] = useState<'grid' | 'list' | 'large' | 'small' | 'grouped'>('grid')
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

  // AI Safety local state inputs (prevents keystroke DB lag)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [filterPorn, setFilterPorn] = useState(true)
  const [filterViolence, setFilterViolence] = useState(true)
  const [filterSelfHarm, setFilterSelfHarm] = useState(true)
  const [filterIllegal, setFilterIllegal] = useState(true)
  const [customFilterTerms, setCustomFilterTerms] = useState<string[]>([])
  const [newCustomTerm, setNewCustomTerm] = useState('')
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [aiCustomContext, setAiCustomContext] = useState('')
  const [filterLogs, setFilterLogs] = useState<Array<{timestamp: string, level: string, message: string, machineId?: number, query?: string}>>([])
  const filterLogEndRef = useRef<HTMLDivElement>(null)
  const [appVersion, setAppVersion] = useState<string>('')

  // Modals & Drawers
  const [selectedMachine, setSelectedMachine] = useState<any>(null)
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false)
  const [selectedDrawerMachine, setSelectedDrawerMachine] = useState<any>(null)

  // New remote control & safety states
  const [isRemoteFullscreen, setIsRemoteFullscreen] = useState(false)
  const [isMouseDown, setIsMouseDown] = useState(false)
  const [lastMoveTime, setLastMoveTime] = useState(0)
  const [commandLine, setCommandLine] = useState('')
  const [commandOutput, setCommandOutput] = useState('')
  const [isExecutingCommand, setIsExecutingCommand] = useState(false)
  const [safetyAlerts, setSafetyAlerts] = useState<any[]>([])

  // Remote monitoring states
  const [screenshotBase64, setScreenshotBase64] = useState<string>('')
  const [screenshotLoading, setScreenshotLoading] = useState(false)
  const [screenshotError, setScreenshotError] = useState('')
  const [screenFrames, setScreenFrames] = useState<Record<number, string>>({})

  // Session Application Activity log states
  const [selectedSessionForLog, setSelectedSessionForLog] = useState<any>(null)
  const [sessionAppLogs, setSessionAppLogs] = useState<any[]>([])
  const [isAppLogModalOpen, setIsAppLogModalOpen] = useState(false)
  const [isLoadingAppLogs, setIsLoadingAppLogs] = useState(false)
  const [appLogTab, setAppLogTab] = useState<'apps' | 'processes'>('apps')
  const [sessionProcessEvents, setSessionProcessEvents] = useState<any[]>([])

  const handleViewAppLog = async (sess: any) => {
    setSelectedSessionForLog(sess)
    setIsAppLogModalOpen(true)
    setIsLoadingAppLogs(true)
    setAppLogTab('apps')
    setSessionProcessEvents([])
    if (window.ipcRenderer) {
      try {
        const [logs, events] = await Promise.all([
          window.ipcRenderer.invoke('get-session-app-logs', sess.id),
          window.ipcRenderer.invoke('get-session-process-events', sess.id)
        ])
        setSessionAppLogs(logs)
        setSessionProcessEvents(Array.isArray(events) ? events : [])
      } catch (err) {
        setSessionAppLogs([])
        setSessionProcessEvents([])
      } finally {
        setIsLoadingAppLogs(false)
      }
    }
  }
  const [systemLogs, setSystemLogs] = useState<any[]>([])
  const [isLogsOpen, setIsLogsOpen] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const fullscreenContainerRef = useRef<HTMLDivElement>(null)

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
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>([])

  // Bulk add states
  const [isBulkUserModalOpen, setIsBulkUserModalOpen] = useState(false)
  const [bulkCsvText, setBulkCsvText] = useState('')
  const [xlsxImportStatus, setXlsxImportStatus] = useState('')

  // Top-Up states
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false)
  const [topUpUser, setTopUpUser] = useState<User | null>(null)
  const [topUpMinutes, setTopUpMinutes] = useState('60')

  // Account & Security form states
  const [secChangeUsernamePass, setSecChangeUsernamePass] = useState('')
  const [secNewUsername, setSecNewUsername] = useState('')
  const [secUsernameMsg, setSecUsernameMsg] = useState('')
  const [secCurPassword, setSecCurPassword] = useState('')
  const [secNewPassword, setSecNewPassword] = useState('')
  const [secConfirmPassword, setSecConfirmPassword] = useState('')
  const [secPasswordMsg, setSecPasswordMsg] = useState('')
  const [secCurOpPassword, setSecCurOpPassword] = useState('')
  const [secNewOpPassword, setSecNewOpPassword] = useState('')
  const [secOpPasswordMsg, setSecOpPasswordMsg] = useState('')

  // Mobile remote control states
  const [serverIp, setServerIp] = useState('127.0.0.1')
  const [publicUrl, setPublicUrl] = useState<string | null>(null)
  const [isQrModalOpen, setIsQrModalOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [qrMode, setQrMode] = useState<'lan' | 'public'>('public')

  // Timeline log details expanded state
  const [expandedTimelineLogs, setExpandedTimelineLogs] = useState<Record<number, boolean>>({})

  // Fullscreen mirror zoom level state
  const [zoomLevel, setZoomLevel] = useState<'fit' | '100' | '150' | '200'>('fit')

  // IPC listener registration guard
  const ipcBound = useRef(false)

  // Time remaining auto-ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setMachines((prevMachines) =>
        prevMachines.map((m) => {
          if (m.status === 'in_use') {
            if (m.mode === 'prepaid') {
              return { ...m, timeRemaining: Math.max(0, m.timeRemaining - 1) }
            } else {
              return { ...m, timeRemaining: m.timeRemaining + 1 }
            }
          }
          return m
        })
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Auto QR mode selector
  useEffect(() => {
    if (isQrModalOpen) {
      setQrMode(publicUrl ? 'public' : 'lan')
    }
  }, [isQrModalOpen, publicUrl])

  // Sync mirror quality when managing a terminal
  useEffect(() => {
    if (window.ipcRenderer) {
      const targetId = selectedDrawerMachine ? Number(selectedDrawerMachine.id) : null;
      window.ipcRenderer.invoke('set-active-mirror', targetId).catch(() => {});
    }
  }, [selectedDrawerMachine?.id]);

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
      window.ipcRenderer.invoke('get-latest-screen-frames').then(setScreenFrames)
      window.ipcRenderer.invoke('get-server-logs').then(setSystemLogs)
      window.ipcRenderer.invoke('get-safety-alerts').then(setSafetyAlerts)
      window.ipcRenderer.invoke('get-server-ip').then((ip: string) => setServerIp(ip || '127.0.0.1')).catch(() => {})
      window.ipcRenderer.invoke('get-public-url').then((url: string) => {
        setPublicUrl(url || null)
        if (url) setQrMode('public')
      }).catch(() => {})
      window.ipcRenderer.invoke('get-app-version').then((v: string) => setAppVersion(v || '')).catch(() => {})

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

      const frameListener = (_: any, payload: { machineId: number, base64: string }) => {
        setScreenFrames((prev) => ({ ...prev, [payload.machineId]: payload.base64 }))
      }
      window.ipcRenderer.on('screen-frame-updated', frameListener)

      const serverLogListener = (_: any, log: any) => {
        setSystemLogs((prev) => {
          const updated = [...prev, log]
          if (updated.length > 100) updated.shift()
          return updated
        })
      }
      window.ipcRenderer.on('server-log', serverLogListener)

      const commandResultListener = (_: any, data: any) => {
        setCommandOutput((prev) => prev + (prev ? '\n' : '') + `> ${data.commandLine}\n${data.output}`)
        setIsExecutingCommand(false)
      }
      window.ipcRenderer.on('remote-command-result', commandResultListener)

      const safetyAlertTriggeredListener = (_: any, data: any) => {
        alert(`🚨 SAFETY ALERT! Machine ID ${data.machineId} searched for prohibited content: "${data.query}" (${data.reason})`)
        window.ipcRenderer.invoke('get-safety-alerts').then(setSafetyAlerts)
      }
      window.ipcRenderer.on('safety-alert-triggered', safetyAlertTriggeredListener)

      const filterLogListener = (_: any, entry: any) => {
        setFilterLogs(prev => { const next = [...prev, entry]; return next.length > 300 ? next.slice(-300) : next })
      }
      window.ipcRenderer.on('filter-log', filterLogListener)

      const publicUrlListener = (_: any, url: string | null) => {
        setPublicUrl(url)
        if (url) setQrMode('public')
      }
      window.ipcRenderer.on('public-url-updated', publicUrlListener)

      return () => {
        window.ipcRenderer?.off('machines-updated', machineListener)
        window.ipcRenderer?.off('update-status', updateListener)
        window.ipcRenderer?.off('screen-frame-updated', frameListener)
        window.ipcRenderer?.off('server-log', serverLogListener)
        window.ipcRenderer?.off('remote-command-result', commandResultListener)
        window.ipcRenderer?.off('safety-alert-triggered', safetyAlertTriggeredListener)
        window.ipcRenderer?.off('filter-log', filterLogListener)
        window.ipcRenderer?.off('public-url-updated', publicUrlListener)
        ipcBound.current = false
      }
    }
  }, [])

  // Poll data periodically if running inside browser bridge mode (non-Electron environment)
  useEffect(() => {
    if (window.ipcRenderer && (window.ipcRenderer as any).isBrowserBridge) {
      const interval = setInterval(() => {
        window.ipcRenderer.invoke('get-machines')
          .then((data) => {
            setMachines(data)
            setSelectedDrawerMachine((prev: any) => {
              if (!prev) return prev
              const updated = data.find((m: any) => m.id === prev.id)
              return updated || prev
            })
          })
          .catch(() => {})
        window.ipcRenderer.invoke('get-server-logs').then(setSystemLogs).catch(() => {})
        window.ipcRenderer.invoke('get-safety-alerts').then(setSafetyAlerts).catch(() => {})
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [])

  // Scroll developer console logs to bottom
  useEffect(() => {
    if (isLogsOpen && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [systemLogs, isLogsOpen])

  useEffect(() => {
    if (window.ipcRenderer) {
      window.ipcRenderer.invoke('set-fullscreen', isRemoteFullscreen)
    }
    if (isRemoteFullscreen) {
      document.body.style.overflow = 'hidden'
      if (fullscreenContainerRef.current) {
        fullscreenContainerRef.current.focus()
      }
    } else {
      document.body.style.overflow = 'unset'
    }
  }, [isRemoteFullscreen])

  // Load plans, rules, settings, reports on tab switches
  useEffect(() => {
    if (isAuthenticated && window.ipcRenderer) {
      if (activeTab === 'plans') {
        window.ipcRenderer.invoke('get-plans').then(setPlans)
      } else if (activeTab === 'blocking') {
        window.ipcRenderer.invoke('get-block-rules').then(setBlockRules)
      } else if (activeTab === 'safety') {
        window.ipcRenderer.invoke('get-safety-alerts').then(setSafetyAlerts)
      } else if (activeTab === 'reports' || activeTab === 'sessions') {
        window.ipcRenderer.invoke('get-reports-summary').then(setReportsData)
        window.ipcRenderer.invoke('get-safety-alerts').then(setSafetyAlerts)
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
        localStorage.setItem('netcafe_auth', 'true')
        localStorage.setItem('netcafe_user', JSON.stringify(res.user))
        setIsAuthenticated(true)
        setCurrentUser(res.user)
      } else {
        setAuthError(res.error)
      }
    } else {
      // Local dev fallback if not running inside Electron wrapper
      localStorage.setItem('netcafe_auth', 'true')
      localStorage.setItem('netcafe_user', JSON.stringify({ username: 'admin', role: 'admin' }))
      setIsAuthenticated(true)
      setCurrentUser({ username: 'admin', role: 'admin' })
    }
  }

  const handleSignOut = () => {
    localStorage.removeItem('netcafe_auth')
    localStorage.removeItem('netcafe_user')
    setIsAuthenticated(false)
    setCurrentUser(null)
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
    setUserPassword(user.password || '') // prefill with existing password
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
    if (!window.ipcRenderer) return
    const mins = parseInt(topUpMinutes) || 0
    if (mins <= 0) {
      alert('Please enter a valid number of minutes')
      return
    }
    if (topUpUser) {
      const res = await window.ipcRenderer.invoke('topup-user', topUpUser.id, mins)
      if (res.success) {
        setIsTopUpModalOpen(false)
        fetchUsers()
      } else {
        alert('Error topping up balance: ' + res.error)
      }
    } else if (selectedUserIds.length > 0) {
      const res = await window.ipcRenderer.invoke('bulk-topup-users', selectedUserIds, mins)
      if (res.success) {
        setIsTopUpModalOpen(false)
        setSelectedUserIds([])
        fetchUsers()
      } else {
        alert('Error topping up balance: ' + res.error)
      }
    }
  }

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedUserIds.length} selected users?`)) return
    if (!window.ipcRenderer) return
    const res = await window.ipcRenderer.invoke('bulk-delete-users', selectedUserIds)
    if (res.success) {
      setSelectedUserIds([])
      fetchUsers()
    } else {
      alert('Error deleting users: ' + res.error)
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
    const machine = machines.find((m: any) => m.id === machineId)
    const machineName = machine ? machine.name : `PC ${machineId}`
    if (confirm(`Are you sure you want to shutdown terminal "${machineName}"?`)) {
      if (window.ipcRenderer) await window.ipcRenderer.invoke('power-machine', machineId)
    }
  }

  const handleRestart = async (machineId: number) => {
    const machine = machines.find((m: any) => m.id === machineId)
    const machineName = machine ? machine.name : `PC ${machineId}`
    if (confirm(`Are you sure you want to restart terminal "${machineName}"?`)) {
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

  const handleToggleHardwareLock = async (machineId: number, block: boolean) => {
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke('toggle-hardware-lock', machineId, block)
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

  const getScaledCoordinates = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickXRelative = e.clientX - rect.left
    const clickYRelative = e.clientY - rect.top

    const naturalWidth = e.currentTarget.naturalWidth || 400
    const naturalHeight = e.currentTarget.naturalHeight || 225
    const imageRatio = naturalWidth / naturalHeight
    const elementRatio = rect.width / rect.height

    let renderWidth = rect.width
    let renderHeight = rect.height
    let offsetX = 0
    let offsetY = 0

    if (elementRatio > imageRatio) {
      // Bounding box is wider than the image: height-constrained (pillarbox black bars on left/right)
      renderWidth = rect.height * imageRatio
      offsetX = (rect.width - renderWidth) / 2
    } else if (elementRatio < imageRatio) {
      // Bounding box is taller than the image: width-constrained (letterbox black bars on top/bottom)
      renderHeight = rect.width / imageRatio
      offsetY = (rect.height - renderHeight) / 2
    }

    // Clamp click position to actual rendered image dimensions
    const clickX = Math.max(0, Math.min(renderWidth, clickXRelative - offsetX))
    const clickY = Math.max(0, Math.min(renderHeight, clickYRelative - offsetY))

    const resolution = selectedDrawerMachine?.metrics?.resolution || { width: 1920, height: 1080 }

    return {
      x: Math.round((clickX / renderWidth) * resolution.width),
      y: Math.round((clickY / renderHeight) * resolution.height)
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLImageElement>, machineId: number) => {
    if (!window.ipcRenderer) return
    setIsMouseDown(true)
    const { x, y } = getScaledCoordinates(e)
    let button = 'left'
    if (e.button === 2) button = 'right'
    else if (e.button === 1) button = 'middle'
    
    window.ipcRenderer.invoke('send-remote-input', machineId, {
      action: 'mousedown',
      button,
      x,
      y
    })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLImageElement>, machineId: number) => {
    if (!window.ipcRenderer || !isMouseDown) return
    const now = Date.now()
    if (now - lastMoveTime < 80) return
    setLastMoveTime(now)
    
    const { x, y } = getScaledCoordinates(e)
    window.ipcRenderer.invoke('send-remote-input', machineId, {
      action: 'move',
      x,
      y
    })
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLImageElement>, machineId: number) => {
    if (!window.ipcRenderer) return
    setIsMouseDown(false)
    const { x, y } = getScaledCoordinates(e)
    let button = 'left'
    if (e.button === 2) button = 'right'
    else if (e.button === 1) button = 'middle'
    
    window.ipcRenderer.invoke('send-remote-input', machineId, {
      action: 'mouseup',
      button,
      x,
      y
    })
  }

  const handleDoubleClick = (e: React.MouseEvent<HTMLImageElement>, machineId: number) => {
    if (!window.ipcRenderer) return
    const { x, y } = getScaledCoordinates(e)
    window.ipcRenderer.invoke('send-remote-input', machineId, {
      action: 'click',
      button: 'double',
      x,
      y
    })
  }

  const handleRemoteKeyboardEvent = (e: React.KeyboardEvent<HTMLDivElement>, machineId: number) => {
    if (!window.ipcRenderer) return
    e.preventDefault()
    e.stopPropagation()
    
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      return
    }
    
    let key = e.key
    const specialKeys: Record<string, string> = {
      Enter: '{ENTER}',
      Backspace: '{BACKSPACE}',
      Tab: '{TAB}',
      Escape: '{ESC}',
      Delete: '{DEL}',
      ArrowUp: '{UP}',
      ArrowDown: '{DOWN}',
      ArrowLeft: '{LEFT}',
      ArrowRight: '{RIGHT}',
      F1: '{F1}', F2: '{F2}', F3: '{F3}', F4: '{F4}', F5: '{F5}', F6: '{F6}',
      F7: '{F7}', F8: '{F8}', F9: '{F9}', F10: '{F10}', F11: '{F11}', F12: '{F12}',
      Space: ' ',
      ' ': ' ',
    }
    
    let resolvedKey = ''
    if (specialKeys[key]) {
      resolvedKey = specialKeys[key]
    } else if (key.length === 1) {
      if ('+^%~{}[]()'.includes(key)) {
        resolvedKey = `{${key}}`
      } else {
        resolvedKey = key
      }
    } else {
      return
    }
    
    let prefix = ''
    if (e.ctrlKey) prefix += '^'
    if (e.shiftKey && key.length > 1) prefix += '+'
    if (e.altKey) prefix += '%'
    
    window.ipcRenderer.invoke('send-remote-input', machineId, {
      action: 'keys',
      value: prefix + resolvedKey
    })
  }

  const handleExecuteCommand = async (machineId: number) => {
    if (!commandLine.trim() || !window.ipcRenderer) return
    setIsExecutingCommand(true)
    setCommandOutput(prev => prev + (prev ? '\n' : '') + `> Sending command: ${commandLine}...`)
    await window.ipcRenderer.invoke('execute-remote-command', machineId, commandLine)
    setCommandLine('')
  }

  const handleClearSafetyAlerts = async () => {
    if (confirm('Are you sure you want to clear all safety alerts from history?') && window.ipcRenderer) {
      await window.ipcRenderer.invoke('clear-safety-alerts')
      window.ipcRenderer.invoke('get-safety-alerts').then(setSafetyAlerts)
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

  const handleUpdateSetting = async (key: string, value: string) => {
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke('update-settings', key, value)
      const fresh = await window.ipcRenderer.invoke('get-settings')
      setSettings(fresh)
    }
  }

  useEffect(() => {
    if (settings) {
      setApiKeyInput(settings.gemini_api_key || '')
      setAiCustomContext(settings.ai_custom_context || '')
      setFilterPorn(settings.filter_porn !== 'false')
      setFilterViolence(settings.filter_violence !== 'false')
      setFilterSelfHarm(settings.filter_self_harm !== 'false')
      setFilterIllegal(settings.filter_illegal !== 'false')
      try {
        setCustomFilterTerms(JSON.parse(settings.custom_filter_terms || '[]'))
      } catch { setCustomFilterTerms([]) }
    }
  }, [settings])

  const handleSaveSafetySettings = async () => {
    if (window.ipcRenderer) {
      setIsSavingSettings(true)
      setSaveStatus('Saving...')
      try {
        await window.ipcRenderer.invoke('update-settings', 'gemini_api_key', apiKeyInput)
        await window.ipcRenderer.invoke('update-settings', 'filter_porn', filterPorn ? 'true' : 'false')
        await window.ipcRenderer.invoke('update-settings', 'filter_violence', filterViolence ? 'true' : 'false')
        await window.ipcRenderer.invoke('update-settings', 'filter_self_harm', filterSelfHarm ? 'true' : 'false')
        await window.ipcRenderer.invoke('update-settings', 'filter_illegal', filterIllegal ? 'true' : 'false')
        await window.ipcRenderer.invoke('update-settings', 'custom_filter_terms', JSON.stringify(customFilterTerms))
        await window.ipcRenderer.invoke('update-settings', 'ai_custom_context', aiCustomContext)
        const fresh = await window.ipcRenderer.invoke('get-settings')
        setSettings(fresh)
        setSaveStatus('Settings saved successfully!')
        setTimeout(() => setSaveStatus(''), 3000)
      } catch (err) {
        setSaveStatus('Failed to save settings.')
      } finally {
        setIsSavingSettings(false)
      }
    }
  }

  const handleAddCustomTerm = () => {
    const term = newCustomTerm.trim()
    if (term && !customFilterTerms.includes(term)) {
      setCustomFilterTerms(prev => [...prev, term])
      setNewCustomTerm('')
    }
  }

  const handleRemoveCustomTerm = (term: string) => {
    setCustomFilterTerms(prev => prev.filter(t => t !== term))
  }

  const handleFullscreenKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, machineId: number) => {
    if (e.key === 'Escape') {
      setIsRemoteFullscreen(false)
      if (window.ipcRenderer && selectedDrawerMachine) {
        window.ipcRenderer.invoke('set-fullscreen-mirror', null).catch(() => {})
      }
      e.preventDefault()
      e.stopPropagation()
      return
    }
    handleRemoteKeyboardEvent(e, machineId)
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

  const formatTimestamp = (ts: string) => {
    if (!ts) return ''
    const normalized = ts.includes(' ') && !ts.includes('T') ? ts.replace(' ', 'T') + 'Z' : ts
    try {
      return new Date(normalized).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return ts
    }
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
                placeholder="Username"
                autoFocus
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
              <div className="flex flex-col gap-1 text-xs bg-red-950/40 border border-red-800/50 p-3 rounded text-red-400">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={16} />
                  <span>{authError}</span>
                </div>
                <div className="text-slate-500 pl-6">Default credentials: <span className="text-slate-400 font-mono">admin / admin</span></div>
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
    <div className="h-screen overflow-hidden bg-slate-950 text-slate-50 flex flex-col">
      {/* Top Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center justify-between w-full md:w-auto gap-3">
          <div className="flex items-center gap-3">
            <Monitor className="text-blue-500" size={32} />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">{settings.lab_name}</h1>
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span>Operator: {currentUser?.username} ({currentUser?.role})</span>
                {appVersion && (
                  <span className="ml-1 px-1.5 py-0.5 bg-blue-500/15 border border-blue-500/25 text-blue-400 rounded text-[10px] font-semibold tracking-wide">v{appVersion}</span>
                )}
              </div>
            </div>
          </div>
          {/* Hamburger menu trigger */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden p-2 text-slate-400 hover:text-white bg-slate-800/55 hover:bg-slate-800 rounded-lg transition-colors border border-slate-700/20"
          >
            <Menu size={20} />
          </button>
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
              id="nav-safety"
              onClick={() => { setActiveTab('safety'); setSelectedDrawerMachine(null) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'safety' ? 'bg-red-700 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <ShieldAlert size={18} /> AI Safety
              {safetyAlerts.length > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {safetyAlerts.length > 99 ? '99+' : safetyAlerts.length}
                </span>
              )}
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
            <div className="font-semibold text-slate-400">NetCafe Server v1.0.26</div>
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
            <button
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-red-950/40 hover:bg-red-900/20 text-red-400 rounded text-xs font-semibold border border-red-900/20 transition-colors mt-2"
            >
              <Power size={11} /> Sign Out
            </button>
          </div>
        </nav>

        {/* Workspace Panels */}
        <main className="flex-1 p-6 overflow-y-auto bg-slate-950 flex flex-col">
          
          {/* TAB: Dashboard */}
          {activeTab === 'dashboard' && (
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-900/60">
                <div>
                  <h2 className="text-xl font-bold text-white">Dashboard</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Real-time status and monitoring of cafe terminals</p>
                </div>
                <div className="flex items-center gap-2">
                  {/* View Mode Toggle */}
                  <div className="flex items-center bg-slate-900 border border-slate-800 rounded overflow-hidden text-xs font-bold">
                    {(['grid', 'large', 'small', 'list', 'grouped'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setDashboardView(mode)}
                        className={`px-2.5 py-1.5 capitalize transition-colors ${
                          dashboardView === mode
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {mode === 'grid' ? '⊞ Grid' : mode === 'large' ? '⬜ Large' : mode === 'small' ? '⊠ Small' : mode === 'list' ? '☰ List' : '⊟ Group'}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={async () => {
                      if (window.ipcRenderer) {
                        const data = await window.ipcRenderer.invoke('get-machines')
                        setMachines(data)
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded text-xs font-semibold transition-colors"
                  >
                    <RefreshCcw size={12} />
                    <span>Reload Terminals</span>
                  </button>
                </div>
              </div>

              {machines.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                  <ServerOff size={64} className="mb-4 opacity-50 text-slate-600" />
                  <h2 className="text-2xl font-bold text-slate-400">No machines connected yet</h2>
                  <p className="mt-2 text-sm max-w-md text-center">
                    Client agents connected on the same LAN will register here automatically.
                  </p>
                </div>
              ) : dashboardView === 'list' ? (
                <div className="flex flex-col gap-2 flex-1">
                  {machines.map((machine) => (
                    <div
                      key={machine.id}
                      className={`flex items-center gap-4 px-4 py-3 bg-slate-900/60 border rounded-lg hover:border-slate-700 transition-all shadow ${
                        selectedDrawerMachine?.id === machine.id ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-slate-800/80'
                      }`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getStatusColor(machine.status).split(' ')[0]}`} />
                      <span className="font-bold text-white w-28 truncate">{machine.name}</span>
                      <span className="text-[10px] uppercase font-bold text-slate-400 w-20">{machine.status.replace('_', ' ')}</span>
                      {(machine.status === 'in_use' || machine.status === 'paused') && (
                        <span className="font-mono text-sm text-white w-24">{formatTime(machine.timeRemaining || 0)}</span>
                      )}
                      {machine.status === 'in_use' && (
                        <span className="text-xs text-blue-400 truncate flex-1">{machine.user || 'Guest'}</span>
                      )}
                      <div className="flex gap-1.5 ml-auto">
                        {machine.status === 'available' && (
                          <button onClick={() => handleOpenClick(machine)} className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold">Open</button>
                        )}
                        {machine.status === 'in_use' && (
                          <>
                            <button onClick={() => handlePause(machine.id)} className="px-2.5 py-1 bg-amber-600/20 border border-amber-600/50 text-amber-400 rounded text-xs font-bold">Pause</button>
                            <button onClick={() => handleCloseClick(machine)} className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold">Close</button>
                          </>
                        )}
                        {machine.status === 'paused' && (
                          <>
                            <button onClick={() => handleResume(machine.id)} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold">Resume</button>
                            <button onClick={() => handleCloseClick(machine)} className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold">Close</button>
                          </>
                        )}
                        <button
                          onClick={() => { setSelectedDrawerMachine(machine); setScreenshotBase64(''); setScreenshotError('') }}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-bold"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : dashboardView === 'grouped' ? (
                <div className="flex flex-col gap-6 flex-1">
                  {(['in_use', 'paused', 'available', 'offline'] as const).map((status) => {
                    const group = machines.filter((m) => m.status === status)
                    if (group.length === 0) return null
                    const labels: Record<string, string> = { in_use: '🟢 Active', paused: '🟡 Paused', available: '🔵 Available', offline: '⚫ Offline' }
                    return (
                      <div key={status}>
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                          {labels[status]}
                          <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full text-[10px]">{group.length}</span>
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                          {group.map((machine) => (
                            <div
                              key={machine.id}
                              className={`bg-slate-900/60 border rounded-xl overflow-hidden hover:border-slate-700 transition-all flex flex-col shadow-lg ${
                                selectedDrawerMachine?.id === machine.id ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-slate-800/80'
                              }`}
                            >
                              <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-950/20">
                                <div className="flex items-center gap-2">
                                  <h2 className="text-sm font-bold text-white">{machine.name}</h2>
                                  <button
                                    onClick={() => { setSelectedDrawerMachine(machine); setScreenshotBase64(''); setScreenshotError('') }}
                                    className="text-slate-400 hover:text-blue-400 hover:bg-slate-800/80 transition-all py-0.5 px-1.5 rounded flex items-center gap-1 text-[10px] bg-slate-900/60 border border-slate-800/80"
                                  >
                                    <Menu size={10} /><span>Manage</span>
                                  </button>
                                </div>
                                <div className={`w-2 h-2 rounded-full ${getStatusColor(machine.status).split(' ')[0]}`} />
                              </div>
                              <div className="p-4 flex-1 flex flex-col justify-center items-center text-center">
                                {machine.status === 'in_use' || machine.status === 'paused' ? (
                                  <>
                                    <div className="text-2xl font-mono font-bold tracking-widest text-white mb-1">{formatTime(machine.timeRemaining || 0)}</div>
                                    <div className="text-xs text-slate-400">User: <span className="text-blue-400 font-semibold">{machine.user || 'Guest'}</span></div>
                                  </>
                                ) : (
                                  <div className="text-slate-500 font-medium text-xs my-2">
                                    {machine.status === 'available' ? 'Available' : 'Offline'}
                                  </div>
                                )}
                              </div>
                              <div className="p-2 bg-slate-950/50 border-t border-slate-850 flex flex-wrap gap-1.5 justify-center">
                                {machine.status === 'available' && (
                                  <button onClick={() => handleOpenClick(machine)} className="flex-1 flex justify-center items-center gap-1 py-1 px-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-xs"><Play size={12} />Open</button>
                                )}
                                {machine.status === 'in_use' && (
                                  <>
                                    <button onClick={() => handlePause(machine.id)} className="flex-1 flex justify-center items-center gap-1 py-1 px-2 bg-amber-600/20 border border-amber-600/50 text-amber-400 rounded font-semibold text-xs"><Pause size={12} />Pause</button>
                                    <button onClick={() => handleCloseClick(machine)} className="flex-1 flex justify-center items-center gap-1 py-1 px-2 bg-red-600 hover:bg-red-500 text-white rounded font-medium text-xs"><Square size={12} />Close</button>
                                  </>
                                )}
                                {machine.status === 'paused' && (
                                  <>
                                    <button onClick={() => handleResume(machine.id)} className="flex-1 flex justify-center items-center gap-1 py-1 px-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium text-xs"><Play size={12} />Resume</button>
                                    <button onClick={() => handleCloseClick(machine)} className="flex-1 flex justify-center items-center gap-1 py-1 px-2 bg-red-600 hover:bg-red-500 text-white rounded font-medium text-xs"><Square size={12} />Close</button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className={`${
                  dashboardView === 'large'
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-6 flex-1 items-start'
                    : dashboardView === 'small'
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 flex-1 items-start'
                    : 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6 flex-1 items-start'
                }`}>
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
                            className="text-slate-400 hover:text-blue-400 hover:bg-slate-800/80 transition-all py-1 px-2 rounded flex items-center gap-1.5 text-xs bg-slate-900/60 border border-slate-800/80"
                            title="Remote control & metrics"
                          >
                            <Menu size={12} />
                            <span>Manage</span>
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-bold tracking-tight text-slate-400">
                            {machine.status.replace('_', ' ')}
                          </span>
                          <div className={`w-2 h-2 rounded-full ${getStatusColor(machine.status).split(' ')[0]}`} />
                        </div>
                      </div>

                      {/* Live Screen Mirror Thumbnail */}
                      <div className="relative w-full h-[120px] bg-slate-950 flex items-center justify-center overflow-hidden border-b border-slate-800/60 group">
                        {machine.status !== 'offline' && screenFrames[machine.id] ? (
                          <img 
                            src={`data:image/jpeg;base64,${screenFrames[machine.id]}`} 
                            alt="Live screen preview"
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-slate-700">
                            <Monitor size={24} className="opacity-40" />
                            <span className="text-[9px] font-semibold tracking-wider uppercase">
                              {machine.status === 'offline' ? 'Offline' : 'Connecting Mirror...'}
                            </span>
                          </div>
                        )}
                        
                        {machine.status !== 'offline' && screenFrames[machine.id] && (
                          <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600 text-[8px] font-bold text-white px-1.5 py-0.5 rounded shadow-md">
                            <span className="w-1 h-1 bg-white rounded-full animate-ping" />
                            <span>LIVE</span>
                          </div>
                        )}
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

              {/* Developer Logs Console */}
              <div className="mt-8 bg-slate-900/40 border border-slate-800/80 rounded-xl overflow-hidden shadow-lg">
                <div 
                  onClick={() => setIsLogsOpen(!isLogsOpen)}
                  className="p-4 bg-slate-950/20 border-b border-slate-850 flex justify-between items-center cursor-pointer hover:bg-slate-900/30 select-none"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Developer System Log Console</h3>
                  </div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold">{isLogsOpen ? 'Hide ▲' : 'Show ▼'}</span>
                </div>
                {isLogsOpen && (
                  <div className="p-4 bg-slate-950/80 font-mono text-[11px] text-slate-300 max-h-[160px] overflow-y-auto space-y-1">
                    {systemLogs.length === 0 ? (
                      <div className="text-slate-500 italic">No logs recorded yet.</div>
                    ) : (
                      systemLogs.map((log, index) => (
                        <div key={index} className="flex gap-2.5">
                          <span className="text-slate-500">[{log.timestamp}]</span>
                          <span className="text-slate-200">{log.message}</span>
                        </div>
                      ))
                    )}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
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
                      <th className="p-4">Activity</th>
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
                        <td className="p-4">
                          <button
                            onClick={() => handleViewAppLog(sess)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-750 text-slate-300 hover:text-white rounded text-xs font-semibold transition-all flex items-center gap-1.5"
                          >
                            <Activity size={11} className="text-blue-400" /> View Log
                          </button>
                        </td>
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

          {/* TAB: AI Safety */}
          {activeTab === 'safety' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center pb-4 border-b border-slate-900">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <ShieldAlert size={20} className="text-red-400" /> AI Safety Guard
                </h2>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    settings.ai_safety_enabled === 'true' ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-800 text-slate-500'
                  }`}>
                    {settings.ai_safety_enabled === 'true' ? '● ACTIVE' : '○ INACTIVE'}
                  </span>
                  <button
                    onClick={() => handleUpdateSetting('ai_safety_enabled', settings.ai_safety_enabled === 'true' ? 'false' : 'true')}
                    className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                      settings.ai_safety_enabled === 'true'
                        ? 'bg-red-700 hover:bg-red-600 text-white'
                        : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    }`}
                  >
                    {settings.ai_safety_enabled === 'true' ? 'Disable Filter' : 'Enable Filter'}
                  </button>
                </div>
              </div>

              {/* Active AI System Context / Prompt Preview */}
              <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Terminal size={16} className="text-blue-400" /> Active AI System Context (Layer 2)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">The exact hardcoded system prompt and configuration passed to Gemini 2.5 Flash for filtering.</p>
                </div>
                
                <div className="bg-slate-950 border border-slate-800/60 rounded-lg p-4 font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap select-all">
                  {`You are a safety filter for a cybercafe. Analyze this search query and decide if it is unsafe or violates safety rules. Unsafe topics to filter: ${[
                    settings.filter_porn !== 'false' ? 'pornography/adult content' : null,
                    settings.filter_violence !== 'false' ? 'severe violence/gore/terrorist activities' : null,
                    settings.filter_self_harm !== 'false' ? 'self-harm/suicide instructions' : null,
                    settings.filter_illegal !== 'false' ? 'illegal acts/weapons/hacking guides' : null,
                    settings.custom_filter_terms && JSON.parse(settings.custom_filter_terms || '[]').length > 0
                      ? `any of these specific blocked terms/topics: ${JSON.parse(settings.custom_filter_terms).join(', ')}`
                      : null
                  ].filter(Boolean).join(', ') || 'none'}.${
                    settings.ai_custom_context?.trim()
                      ? `\nAdditional instructions from administrator: ${settings.ai_custom_context.trim()}`
                      : ''
                  }
Respond strictly in JSON format:
{
  "isUnsafe": true or false,
  "category": "Reason/category if unsafe, otherwise empty string",
  "reason": "Brief explanation of why this query is allowed or blocked (e.g. why it is safe or unsafe)"
}`}
                </div>
              </div>

              <div className="bg-slate-900/40 border border-slate-900 rounded-xl overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-slate-900 bg-slate-950/30">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <AlertTriangle size={15} className="text-amber-400" /> Real-Time Violation Log
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{safetyAlerts.length} total</span>
                    {safetyAlerts.length > 0 && (
                      <button
                        onClick={handleClearSafetyAlerts}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-red-900/40 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-800 rounded text-xs font-semibold transition-all"
                      >Clear All</button>
                    )}
                  </div>
                </div>
                {safetyAlerts.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center text-slate-600">
                    <ShieldAlert size={40} className="mb-3 text-slate-800" />
                    <div className="text-sm font-semibold text-slate-500">No violations logged</div>
                    <div className="text-xs mt-1.5 text-slate-600">Alerts appear instantly when a client searches prohibited content.</div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-950 text-slate-400 border-b border-slate-900 text-xs uppercase tracking-wider font-semibold">
                          <th className="p-4">Terminal</th>
                          <th className="p-4">Active User</th>
                          <th className="p-4">Search Query</th>
                          <th className="p-4">Reason</th>
                          <th className="p-4">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900">
                        {safetyAlerts.map((alert: any) => (
                          <tr key={alert.id} className="hover:bg-red-950/20 transition-colors">
                            <td className="p-4 font-semibold text-white">{alert.machine_name || `PC-${alert.machine_id}`}</td>
                            <td className="p-4 text-slate-300 text-xs font-semibold">{alert.user_details || 'Walk-in User'}</td>
                            <td className="p-4 font-mono text-red-300 text-xs">{alert.query}</td>
                            <td className="p-4 text-slate-300 text-xs">{alert.reason}</td>
                            <td className="p-4 font-mono text-xs text-slate-400">{new Date(alert.timestamp).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Live Filter Log */}
              <div className="bg-slate-950 border border-slate-900 rounded-xl overflow-hidden">
                <div className="flex justify-between items-center px-4 py-3 border-b border-slate-900">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="text-green-400 font-mono text-xs">▶</span> Live Filter Log
                  </h3>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-600">{filterLogs.length} entries</span>
                    <button onClick={() => setFilterLogs([])} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Clear</button>
                  </div>
                </div>
                <div className="font-mono text-xs p-3 space-y-0.5 h-52 overflow-y-auto bg-slate-950">
                  {filterLogs.length === 0 ? (
                    <div className="text-slate-700 py-6 text-center">
                      Waiting for activity... Filter events will stream here in real-time when clients search.
                    </div>
                  ) : (
                    filterLogs.map((log, i) => (
                      <div key={i} className={`flex gap-2 leading-relaxed ${
                        log.level === 'block' ? 'text-red-400' :
                        log.level === 'allow' ? 'text-emerald-400' :
                        log.level === 'warn' ? 'text-amber-400' :
                        'text-slate-500'
                      }`}>
                        <span className="text-slate-700 shrink-0">[{log.timestamp}]</span>
                        <span className="break-all">
                          {log.level === 'block' ? '❌' : log.level === 'allow' ? '✅' : log.level === 'warn' ? '⚠️' : '→'}{' '}
                          {log.message}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={filterLogEndRef} />
                </div>
              </div>

              <div className="text-xs text-slate-500 bg-slate-900/30 border border-slate-900 rounded-lg p-3">
                Configure Gemini API key, filter categories, and custom blocked terms in
                <button onClick={() => setActiveTab('settings')} className="text-blue-400 hover:underline ml-1">⚙️ Settings → AI Safety Filter</button>.
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

              {/* AI Safety Alerts Log */}
              <div className="bg-slate-900/40 border border-slate-900 rounded-xl p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-md font-bold text-white flex items-center gap-2">
                    <ShieldAlert size={18} className="text-red-500" /> AI Safety Violation Alerts (FG Filtering)
                  </h3>
                  {safetyAlerts.length > 0 && (
                    <button
                      onClick={handleClearSafetyAlerts}
                      className="px-3 py-1.5 bg-red-950/20 hover:bg-red-900/30 border border-red-900/30 text-red-400 hover:text-red-350 rounded text-xs font-bold transition-all flex items-center gap-1.5"
                    >
                      <Trash2 size={12} /> Clear History
                    </button>
                  )}
                </div>

                {safetyAlerts.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-6 bg-slate-950/20 rounded border border-dashed border-slate-800/80">
                    No safety violations have been logged. Keep up the good work!
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded border border-slate-900">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-950/80 border-b border-slate-900 text-slate-400">
                          <th className="p-3 font-semibold">Terminal</th>
                          <th className="p-3 font-semibold">Search Query</th>
                          <th className="p-3 font-semibold">Violation Reason</th>
                          <th className="p-3 font-semibold">Logged At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/50">
                        {safetyAlerts.map((alert: any) => (
                          <tr key={alert.id} className="hover:bg-slate-950/25 transition-colors">
                            <td className="p-3 text-slate-200 font-medium">{alert.machine_name || `ID ${alert.machine_id}`}</td>
                            <td className="p-3 text-red-300 font-mono select-text bg-slate-950/10 max-w-[200px] truncate" title={alert.query}>{alert.query}</td>
                            <td className="p-3 text-slate-400">{alert.reason}</td>
                            <td className="p-3 text-slate-500 font-mono">{new Date(alert.timestamp).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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

                {/* AI Safety Config (FG Filtering) */}
                <div className="bg-slate-900/50 border border-slate-900 p-6 rounded-xl space-y-4">
                  <h3 className="text-md font-bold text-white flex items-center gap-2">
                    <ShieldAlert size={18} className="text-red-500" /> AI Safety Filter (FG Filtering)
                  </h3>
                  <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-800/60 rounded-lg">
                    <div className="space-y-0.5">
                      <label className="text-sm font-semibold text-white">Enable AI Safety Filter</label>
                      <p className="text-xs text-slate-400">Classifies clients' Google, YouTube, Yahoo, & Bing search queries via Gemini.</p>
                    </div>
                    <input
                      type="checkbox"
                      className="w-5 h-5 accent-blue-600 rounded bg-slate-950 border border-slate-800 cursor-pointer"
                      checked={settings.ai_safety_enabled === 'true'}
                      onChange={(e) => handleUpdateSetting('ai_safety_enabled', e.target.checked ? 'true' : 'false')}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-slate-400">Gemini API Key</label>
                    <input
                      type="password"
                      placeholder="Enter Gemini API Key..."
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors font-mono text-sm"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                    />
                    <p className="text-[10px] text-slate-500">Requires a valid Gemini API key to check safety (uses gemini-2.5-flash).</p>
                  </div>

                  {/* Safety Categories */}
                  <div className="space-y-2.5 pt-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Filter Safety Categories</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/30 border border-slate-850 p-3.5 rounded-lg">
                      <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer hover:text-white">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-blue-600 cursor-pointer rounded"
                          checked={filterPorn}
                          onChange={(e) => setFilterPorn(e.target.checked)}
                        />
                        Pornography & Adult Content
                      </label>
                      <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer hover:text-white">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-blue-600 cursor-pointer rounded"
                          checked={filterViolence}
                          onChange={(e) => setFilterViolence(e.target.checked)}
                        />
                        Violence, Gore & Terrorism
                      </label>
                      <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer hover:text-white">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-blue-600 cursor-pointer rounded"
                          checked={filterSelfHarm}
                          onChange={(e) => setFilterSelfHarm(e.target.checked)}
                        />
                        Self-Harm & Suicide
                      </label>
                      <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer hover:text-white">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-blue-600 cursor-pointer rounded"
                          checked={filterIllegal}
                          onChange={(e) => setFilterIllegal(e.target.checked)}
                        />
                        Illegal Acts, Weapons & Hacking
                      </label>
                    </div>
                  </div>

                  {/* Custom Blocked Terms */}
                  <div className="space-y-2.5 pt-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Custom Blocked Terms</label>
                    <p className="text-[10px] text-slate-500">Queries containing any of these words/phrases will instantly lock the terminal — no API key required.</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. gambling, proxy, vpn..."
                        className="flex-1 bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors text-sm"
                        value={newCustomTerm}
                        onChange={(e) => setNewCustomTerm(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomTerm() } }}
                      />
                      <button
                        onClick={handleAddCustomTerm}
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold transition-all flex items-center gap-1.5"
                      >
                        <Plus size={14} /> Add
                      </button>
                    </div>
                    {customFilterTerms.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {customFilterTerms.map((term) => (
                          <span key={term} className="flex items-center gap-1.5 px-2.5 py-1 bg-red-950/60 border border-red-800/50 text-red-300 rounded-full text-xs font-semibold">
                            {term}
                            <button onClick={() => handleRemoveCustomTerm(term)} className="text-red-400 hover:text-white transition-colors ml-0.5">
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Layer 2 — Custom AI Context */}
                  <div className="space-y-2 pt-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Layer 2 — Custom AI Context</label>
                    <p className="text-[10px] text-slate-500">Extra instructions injected into every Gemini prompt. Example: <em className="text-slate-400 not-italic">"This is a school lab. Also block gaming sites and social media."</em></p>
                    <textarea
                      rows={3}
                      placeholder="Leave empty to use default cybercafe safety context, or write your own instructions for the AI..."
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors text-sm resize-none font-mono"
                      value={aiCustomContext}
                      onChange={(e) => setAiCustomContext(e.target.value)}
                    />
                  </div>

                  {/* Submit buttons */}
                  <div className="flex items-center gap-3.5 pt-1">
                    <button
                      onClick={handleSaveSafetySettings}
                      disabled={isSavingSettings}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded text-xs font-bold transition-all shadow-md"
                    >
                      {isSavingSettings ? 'Saving...' : 'Save AI Settings'}
                    </button>
                    {saveStatus && (
                      <span className={`text-xs font-semibold ${saveStatus.includes('successfully') ? 'text-emerald-450 font-bold' : 'text-red-400'}`}>
                        {saveStatus}
                      </span>
                    )}
                  </div>
                </div>

                {/* Mobile Remote Control */}
                <div className="bg-slate-900/50 border border-slate-900 p-6 rounded-xl space-y-4">
                  <h3 className="text-md font-bold text-white flex items-center gap-2">
                    <Smartphone size={18} className="text-emerald-500" /> Mobile Remote Control
                  </h3>
                  <p className="text-xs text-slate-400">
                    Control the cybercafe server dashboard from any phone, tablet, or secondary device over the Local Network or the Internet.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg flex flex-col justify-between">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Local Wi-Fi Network (LAN)</span>
                        <a 
                          href={`http://${serverIp}:9001`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm font-mono text-emerald-450 hover:underline break-all"
                        >
                          http://{serverIp}:9001
                        </a>
                      </div>
                      <div className="text-[10px] text-slate-505 mt-2">Requires devices to be on the same Wi-Fi.</div>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg flex flex-col justify-between">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-bold text-slate-550 tracking-wider">Public Internet Tunnel</span>
                        {publicUrl ? (
                          <a 
                            href={publicUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm font-mono text-blue-400 hover:underline break-all font-bold"
                          >
                            {publicUrl}
                          </a>
                        ) : (
                          <span className="text-xs text-slate-500 italic flex items-center gap-1.5 mt-1">
                            <Loader2 size={12} className="animate-spin" /> Establishing secure public tunnel...
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-505 mt-2">Access from anywhere on mobile data or other internet networks.</div>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsQrModalOpen(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-550 text-white rounded text-sm font-semibold transition-all shadow-md shadow-emerald-950/20"
                  >
                    <QrCode size={16} /> Show QR Code
                  </button>
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

                {/* Account & Security */}
                <div className="bg-slate-900/50 border border-slate-900 p-6 rounded-xl space-y-6">
                  <h3 className="text-md font-bold text-white flex items-center gap-2">
                    <KeyRound size={18} className="text-blue-500" /> Account &amp; Security
                  </h3>

                  {/* Change Username */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold uppercase text-slate-400">Change Admin Username</label>
                    <div className="space-y-2">
                      <input
                        type="password"
                        placeholder="Current password to confirm"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors text-sm"
                        value={secChangeUsernamePass}
                        onChange={(e) => setSecChangeUsernamePass(e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="New username (min 3 chars)"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors text-sm"
                        value={secNewUsername}
                        onChange={(e) => setSecNewUsername(e.target.value)}
                      />
                    </div>
                    <button
                      onClick={async () => {
                        if (!currentUser) return
                        const res = await window.ipcRenderer?.invoke('change-staff-username', currentUser.username, secChangeUsernamePass, secNewUsername)
                        if (res?.success) {
                          setCurrentUser((prev: any) => ({ ...prev, username: secNewUsername.trim() }))
                          setSecChangeUsernamePass('')
                          setSecNewUsername('')
                          setSecUsernameMsg('✅ Username changed successfully')
                        } else {
                          setSecUsernameMsg(`❌ ${res?.error || 'Failed'}`)
                        }
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold transition-all"
                    >
                      Change Username
                    </button>
                    {secUsernameMsg && <p className={`text-xs font-semibold ${secUsernameMsg.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'}`}>{secUsernameMsg}</p>}
                  </div>

                  <div className="border-t border-slate-800" />

                  {/* Change Password */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold uppercase text-slate-400">Change Admin Password</label>
                    <div className="space-y-2">
                      <input
                        type="password"
                        placeholder="Current password"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors text-sm"
                        value={secCurPassword}
                        onChange={(e) => setSecCurPassword(e.target.value)}
                      />
                      <input
                        type="password"
                        placeholder="New password (min 3 chars)"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors text-sm"
                        value={secNewPassword}
                        onChange={(e) => setSecNewPassword(e.target.value)}
                      />
                      <input
                        type="password"
                        placeholder="Confirm new password"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors text-sm"
                        value={secConfirmPassword}
                        onChange={(e) => setSecConfirmPassword(e.target.value)}
                      />
                    </div>
                    <button
                      onClick={async () => {
                        if (!currentUser) return
                        if (secNewPassword !== secConfirmPassword) {
                          setSecPasswordMsg('❌ Passwords do not match')
                          return
                        }
                        const res = await window.ipcRenderer?.invoke('change-staff-password', currentUser.username, secCurPassword, secNewPassword)
                        if (res?.success) {
                          setSecCurPassword('')
                          setSecNewPassword('')
                          setSecConfirmPassword('')
                          setSecPasswordMsg('✅ Password changed successfully')
                        } else {
                          setSecPasswordMsg(`❌ ${res?.error || 'Failed'}`)
                        }
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold transition-all"
                    >
                      Change Password
                    </button>
                    {secPasswordMsg && <p className={`text-xs font-semibold ${secPasswordMsg.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'}`}>{secPasswordMsg}</p>}
                  </div>

                  <div className="border-t border-slate-800" />

                  {/* Change Operator Password */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold uppercase text-slate-400">Change Operator Terminal Password</label>
                    <p className="text-[11px] text-slate-500">This is the PIN clients use in the ⚙️ settings gear on their terminal to access operator options.</p>
                    <div className="space-y-2">
                      <input
                        type="password"
                        placeholder="Current operator password"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors text-sm"
                        value={secCurOpPassword}
                        onChange={(e) => setSecCurOpPassword(e.target.value)}
                      />
                      <input
                        type="password"
                        placeholder="New operator password (min 3 chars)"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-3 py-2 text-white outline-none transition-colors text-sm"
                        value={secNewOpPassword}
                        onChange={(e) => setSecNewOpPassword(e.target.value)}
                      />
                    </div>
                    <button
                      onClick={async () => {
                        const res = await window.ipcRenderer?.invoke('set-operator-password', secCurOpPassword, secNewOpPassword)
                        if (res?.success) {
                          setSecCurOpPassword('')
                          setSecNewOpPassword('')
                          setSecOpPasswordMsg('✅ Operator password updated and broadcast to all clients')
                        } else {
                          setSecOpPasswordMsg(`❌ ${res?.error || 'Failed'}`)
                        }
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold transition-all"
                    >
                      Update Operator Password
                    </button>
                    {secOpPasswordMsg && <p className={`text-xs font-semibold ${secOpPasswordMsg.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'}`}>{secOpPasswordMsg}</p>}
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

              {/* Bulk Import from Excel */}
              <div className="bg-slate-900/40 border border-slate-900 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <FileSpreadsheet size={16} className="text-emerald-400" /> Bulk Import from Excel
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">Upload an .xlsx file with columns: username, password, email, phone</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!window.ipcRenderer) return
                      const b64 = await window.ipcRenderer.invoke('download-user-template')
                      const url = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${b64}`
                      const a = document.createElement('a'); a.href = url; a.download = 'netcafe_users_template.xlsx'; a.click()
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <Download size={13} /> Download Template
                  </button>
                </div>

                <div className="flex gap-2 items-center">
                  <label
                    htmlFor="xlsxImport"
                    className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-slate-700 hover:border-emerald-600 rounded-lg py-3 cursor-pointer text-xs text-slate-400 hover:text-emerald-400 transition-all"
                  >
                    <Upload size={15} /> Click to select .xlsx file
                    <input
                      id="xlsxImport"
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file || !window.ipcRenderer) return
                        const reader = new FileReader()
                        reader.onload = async (ev) => {
                          const base64 = (ev.target?.result as string).split(',')[1]
                          setXlsxImportStatus('Importing...')
                          const result = await window.ipcRenderer.invoke('bulk-import-users', base64)
                          if (result.ok) {
                            setXlsxImportStatus(`✅ Imported ${result.success} users, skipped ${result.skipped} duplicates${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`)
                            window.ipcRenderer.invoke('get-users').then(setUsers)
                          } else {
                            setXlsxImportStatus(`❌ Error: ${result.error}`)
                          }
                        }
                        reader.readAsDataURL(file)
                        e.target.value = '' // reset so same file can be re-imported
                      }}
                    />
                  </label>
                </div>

                {xlsxImportStatus && (
                  <div className={`text-xs px-3 py-2 rounded border ${
                    xlsxImportStatus.startsWith('✅')
                      ? 'bg-emerald-950/40 border-emerald-900/50 text-emerald-300'
                      : xlsxImportStatus === 'Importing...'
                      ? 'bg-blue-950/40 border-blue-900/50 text-blue-300'
                      : 'bg-red-950/40 border-red-900/50 text-red-300'
                  }`}>
                    {xlsxImportStatus}
                  </div>
                )}
              </div>

              {/* Batch Actions Panel */}
              {selectedUserIds.length > 0 && (
                <div className="flex items-center justify-between bg-blue-950/30 border border-blue-900/50 rounded-xl p-4 mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="text-sm text-blue-300 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span>Selected <strong className="text-white">{selectedUserIds.length}</strong> {selectedUserIds.length === 1 ? 'user' : 'users'}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setTopUpUser(null)
                        setTopUpMinutes('60')
                        setIsTopUpModalOpen(true)
                      }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors"
                    >
                      Batch Top-Up
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-bold transition-colors"
                    >
                      Delete Selected
                    </button>
                    <button
                      onClick={() => setSelectedUserIds([])}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold transition-colors"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
              )}

              {/* Users Table */}
              <div className="bg-slate-900/20 border border-slate-900 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-900 bg-slate-950/40 text-slate-400 text-xs font-bold uppercase tracking-wider">
                        <th className="p-4 w-12 text-center">
                          <input
                            type="checkbox"
                            checked={filteredUsers.length > 0 && filteredUsers.every(u => selectedUserIds.includes(u.id))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedUserIds(prev => {
                                  const union = new Set([...prev, ...filteredUsers.map(u => u.id)])
                                  return Array.from(union)
                                })
                              } else {
                                const filteredIds = filteredUsers.map(u => u.id)
                                setSelectedUserIds(prev => prev.filter(id => !filteredIds.includes(id)))
                              }
                            }}
                            className="rounded border-slate-800 bg-slate-950 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900 w-4 h-4 cursor-pointer"
                          />
                        </th>
                        <th className="p-4">Username</th>
                        <th className="p-4">Password</th>
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
                          <td colSpan={8} className="p-8 text-center text-slate-500">
                            No users found.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => (
                          <tr 
                            key={user.id} 
                            className={`transition-colors ${
                              selectedUserIds.includes(user.id) ? 'bg-blue-950/10 hover:bg-blue-950/20' : 'hover:bg-slate-900/10'
                            }`}
                          >
                            <td className="p-4 w-12 text-center">
                              <input
                                type="checkbox"
                                checked={selectedUserIds.includes(user.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedUserIds(prev => [...prev, user.id])
                                  } else {
                                    setSelectedUserIds(prev => prev.filter(id => id !== user.id))
                                  }
                                }}
                                className="rounded border-slate-800 bg-slate-950 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900 w-4 h-4 cursor-pointer"
                              />
                            </td>
                            <td className="p-4 font-bold text-white">{user.username}</td>
                            <td className="p-4 font-mono text-xs">
                              <div className="flex items-center gap-2">
                                <span>{visiblePasswords[user.id] ? user.password : '••••••••'}</span>
                                <button
                                  type="button"
                                  onClick={() => setVisiblePasswords(prev => ({ ...prev, [user.id]: !prev[user.id] }))}
                                  className="p-1 text-slate-400 hover:text-white transition-colors"
                                  title={visiblePasswords[user.id] ? 'Hide password' : 'Show password'}
                                >
                                  {visiblePasswords[user.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </div>
                            </td>
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

              {/* Interactive Live Screen & Remote Control */}
              {selectedDrawerMachine.status !== 'offline' && (
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex justify-between items-center">
                    <span>Interactive Remote View</span>
                    <span className="text-[10px] text-blue-400 font-mono animate-pulse">Always-On Mirror</span>
                  </div>

                  <button
                    onClick={() => {
                      setIsRemoteFullscreen(true)
                      if (window.ipcRenderer && selectedDrawerMachine) {
                        window.ipcRenderer.invoke('set-fullscreen-mirror', selectedDrawerMachine.id).catch(() => {})
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold transition-all shadow-sm"
                  >
                    <Maximize2 size={12} /> Go Fullscreen Control
                  </button>
                  
                  {screenFrames[selectedDrawerMachine.id] || screenshotBase64 ? (
                    <div 
                      tabIndex={0}
                      onKeyDown={(e) => handleRemoteKeyboardEvent(e, selectedDrawerMachine.id)}
                      className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950 shadow-inner focus:outline-none focus:ring-1 focus:ring-blue-500 relative cursor-crosshair group"
                      title="Click to control mouse. Focus container to type."
                    >
                      <img 
                        src={screenFrames[selectedDrawerMachine.id] 
                          ? `data:image/jpeg;base64,${screenFrames[selectedDrawerMachine.id]}` 
                          : `data:image/png;base64,${screenshotBase64}`
                        } 
                        alt="Client Remote Mirror" 
                        className="w-full h-auto object-contain"
                        onMouseDown={(e) => handleMouseDown(e, selectedDrawerMachine.id)}
                        onMouseMove={(e) => handleMouseMove(e, selectedDrawerMachine.id)}
                        onMouseUp={(e) => handleMouseUp(e, selectedDrawerMachine.id)}
                        onDoubleClick={(e) => handleDoubleClick(e, selectedDrawerMachine.id)}
                        onContextMenu={(e) => e.preventDefault()}
                        onDragStart={(e) => e.preventDefault()}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-slate-950/80 text-[9px] text-slate-400 py-1 text-center border-t border-slate-900 opacity-90 group-focus:hidden">
                        Click to control. Focus this window to type.
                      </div>
                      <div className="absolute inset-x-0 bottom-0 bg-blue-950/90 text-[9px] text-blue-300 py-1 text-center border-t border-blue-900 hidden group-focus:block">
                        Keyboard Active — keypresses are sent to client
                      </div>
                    </div>
                  ) : (
                    <div className="h-32 border border-dashed border-slate-800/80 rounded-lg flex flex-col justify-center items-center text-center p-4 bg-slate-950/20">
                      {screenshotLoading ? (
                        <div className="text-slate-400 text-xs flex flex-col items-center gap-2">
                          <Loader2 size={24} className="animate-spin text-blue-500" />
                          <span>Requesting screenshot from agent...</span>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 space-y-2">
                          {screenshotError && <div className="text-red-400 font-medium mb-1">{screenshotError}</div>}
                          <div>No live screenshot loaded. Connecting to agent mirror...</div>
                        </div>
                      )}
                    </div>
                  )}

                  {!screenshotLoading && (
                    <button
                      onClick={() => handleCaptureScreenshot(selectedDrawerMachine.id)}
                      className="w-full flex items-center justify-center gap-2 py-1.5 bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded text-xs font-bold transition-all"
                    >
                      <RefreshCw size={12} /> Force Screenshot Refresh
                    </button>
                  )}

                  {/* Remote Console CMD Executor Panel */}
                  <div className="space-y-2 pt-2 border-t border-slate-900/60">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Terminal size={12} className="text-blue-400" /> Remote Console CMD
                    </div>
                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-900 text-[10px] font-mono text-slate-300 h-28 overflow-y-auto space-y-1">
                      {commandOutput ? (
                        <pre className="whitespace-pre-wrap select-text">{commandOutput}</pre>
                      ) : (
                        <span className="text-slate-600">Ready to execute console commands on client...</span>
                      )}
                    </div>
                    <form 
                      onSubmit={(e) => { e.preventDefault(); handleExecuteCommand(selectedDrawerMachine.id); }} 
                      className="flex gap-1"
                    >
                      <input
                        type="text"
                        placeholder="cmd.exe command..."
                        className="flex-1 bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-2 py-1 text-xs text-white outline-none transition-colors font-mono"
                        value={commandLine}
                        onChange={(e) => setCommandLine(e.target.value)}
                        disabled={isExecutingCommand}
                      />
                      <button
                        type="submit"
                        disabled={isExecutingCommand || !commandLine.trim()}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded text-xs font-bold transition-all"
                      >
                        {isExecutingCommand ? '...' : 'Run'}
                      </button>
                    </form>
                  </div>
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

              {/* Hardware Input Control */}
              {selectedDrawerMachine.status !== 'offline' && (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Hardware Input Lock</div>
                  <button
                    onClick={() => handleToggleHardwareLock(selectedDrawerMachine.id, !selectedDrawerMachine.hardware_locked)}
                    className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-2 border rounded text-xs font-bold transition-all ${
                      selectedDrawerMachine.hardware_locked
                        ? 'bg-red-950/40 hover:bg-red-900/40 border-red-800/60 text-red-400 hover:text-red-300'
                        : 'bg-slate-800/60 hover:bg-slate-700/60 border-slate-700/50 text-slate-300 hover:text-white'
                    }`}
                  >
                    {selectedDrawerMachine.hardware_locked ? '🔓 Unlock Physical Inputs' : '🔒 Block Physical Inputs'}
                  </button>
                  <p className="text-[10px] text-slate-500">
                    {selectedDrawerMachine.hardware_locked
                      ? 'Physical keyboard/mouse input is currently blocked on the client PC.'
                      : 'Block physical keyboard and mouse inputs on the client machine.'}
                  </p>
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

      {/* Session App Activity Log Modal */}
      {isAppLogModalOpen && selectedSessionForLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <div className="flex items-center gap-2">
                <Activity className="text-blue-500 animate-pulse" size={20} />
                <h3 className="text-md font-bold text-white">
                  Session Application Activity Log: #{selectedSessionForLog.id}
                </h3>
              </div>
              <button 
                type="button" 
                onClick={() => { setIsAppLogModalOpen(false); setSelectedSessionForLog(null); setSessionAppLogs([]); }} 
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 bg-slate-950/40 p-3.5 rounded-lg border border-slate-850 text-xs">
                <div>
                  <span className="text-slate-500 block">Customer</span>
                  <span className="text-white font-semibold">{selectedSessionForLog.customer_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Terminal / PC</span>
                  <span className="text-white font-semibold">{selectedSessionForLog.machine_name || `PC-${selectedSessionForLog.machine_id}`}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Start Time</span>
                  <span className="text-white font-mono">{selectedSessionForLog.start_time}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">End Time</span>
                  <span className="text-white font-mono">{selectedSessionForLog.end_time || 'Active Session'}</span>
                </div>
              </div>

              {/* Modal Tab Switcher */}
              <div className="flex gap-1 bg-slate-950/60 rounded-lg p-1">
                <button
                  onClick={() => setAppLogTab('apps')}
                  className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${
                    appLogTab === 'apps' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Activity size={12} className="inline mr-1" />App Usage
                </button>
                <button
                  onClick={() => setAppLogTab('processes')}
                  className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${
                    appLogTab === 'processes' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ⚙ Process Events ({sessionProcessEvents.length})
                </button>
              </div>

              {appLogTab === 'apps' && (
                isLoadingAppLogs ? (
                  <div className="py-12 flex flex-col items-center justify-center space-y-3">
                    <Loader2 className="animate-spin text-blue-500" size={32} />
                    <span className="text-xs text-slate-400">Retrieving application history from database...</span>
                  </div>
                ) : sessionAppLogs.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-sm">
                    No application usage records found for this session.
                    <p className="text-xs text-slate-500 mt-1">Logs are automatically captured every 10 seconds via terminal active window heartbeats.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Application Usage Timeline</div>
                    <div className="space-y-2.5">
                      {sessionAppLogs.map((log) => {
                        const hours = Math.floor(log.duration_seconds / 3600);
                        const minutes = Math.floor((log.duration_seconds % 3600) / 60);
                        const seconds = log.duration_seconds % 60;
                        const durationStr = [
                          hours > 0 ? `${hours}h` : null,
                          minutes > 0 ? `${minutes}m` : null,
                          seconds > 0 || (hours === 0 && minutes === 0) ? `${seconds}s` : null
                        ].filter(Boolean).join(' ');

                        const totalDuration = sessionAppLogs.reduce((acc, curr) => acc + curr.duration_seconds, 0);
                        const percent = Math.round((log.duration_seconds / (totalDuration || 1)) * 100);

                        const isExpanded = !!expandedTimelineLogs[log.id];

                        return (
                          <div key={log.id} className="p-3 bg-slate-950/20 border border-slate-800/60 rounded-lg hover:border-slate-800 transition-colors flex flex-col gap-2">
                            <div className="flex justify-between items-start gap-4">
                              <div className="font-mono text-xs text-white truncate max-w-[70%]" title={log.app_title}>
                                {log.app_title}
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <div className="text-right">
                                  <span className="text-blue-400 font-semibold">{durationStr}</span>
                                </div>
                                <button 
                                  onClick={() => setExpandedTimelineLogs(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                                  className="p-1 hover:bg-slate-900 rounded text-slate-400 hover:text-white transition-colors"
                                  title="Toggle details"
                                >
                                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                              </div>
                            </div>
                            <div className="w-full flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-950 rounded overflow-hidden">
                                <div 
                                  className="h-full bg-blue-500 rounded transition-all"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-slate-450 w-7 text-right">{percent}%</span>
                            </div>
                            {isExpanded && (
                              <div className="mt-1.5 pt-2 border-t border-slate-900/40 grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400 bg-slate-950/40 p-2 rounded">
                                <div>
                                  <span className="text-slate-500 block">First Focused</span>
                                  <span className="text-slate-300">{formatTimestamp(log.first_seen)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Last Active</span>
                                  <span className="text-slate-300">{formatTimestamp(log.last_seen)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Focus Count</span>
                                  <span className="text-slate-300">{log.focus_count} times</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Exact Duration</span>
                                  <span className="text-slate-300">{log.duration_seconds}s</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              )}

              {appLogTab === 'processes' && (
                <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                  {sessionProcessEvents.length === 0 ? (
                    <div className="py-10 text-center text-slate-500 text-sm">No process events recorded for this session.</div>
                  ) : (
                    sessionProcessEvents.map((evt: any) => (
                      <div key={evt.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${
                        evt.event_type === 'started'
                          ? 'bg-emerald-950/30 border-emerald-900/40'
                          : 'bg-red-950/30 border-red-900/40'
                      }`}>
                        <span className={`font-bold w-14 shrink-0 ${
                          evt.event_type === 'started' ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {evt.event_type === 'started' ? '▶ START' : '■ STOP'}
                        </span>
                        <span className="font-mono flex-1 truncate text-slate-200">{evt.process_name}</span>
                        <span className="text-slate-500 font-mono shrink-0">
                          {new Date(evt.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 flex justify-end bg-slate-950/25">
              <button
                type="button"
                onClick={() => { setIsAppLogModalOpen(false); setSelectedSessionForLog(null); setSessionAppLogs([]); setSessionProcessEvents([]); }}
                className="py-1.5 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold transition-all"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          {/* Drawer Panel */}
          <div className="relative flex flex-col w-64 max-w-xs bg-slate-950 border-r border-slate-900 p-4 h-full">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-900">
              <div className="flex items-center gap-2">
                <Monitor className="text-blue-500" size={20} />
                <span className="font-bold text-white text-sm">Navigation</span>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 space-y-1 overflow-y-auto">
              <button
                onClick={() => { setActiveTab('dashboard'); setSelectedDrawerMachine(null); setIsMobileMenuOpen(false) }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <LayoutDashboard size={18} /> Dashboard
              </button>
              <button
                onClick={() => { setActiveTab('sessions'); setSelectedDrawerMachine(null); setIsMobileMenuOpen(false) }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === 'sessions' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <History size={18} /> Sessions History
              </button>
              <button
                onClick={() => { setActiveTab('plans'); setSelectedDrawerMachine(null); setIsMobileMenuOpen(false) }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === 'plans' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <Plus size={18} /> Pricing Plans
              </button>
              <button
                onClick={() => { setActiveTab('blocking'); setSelectedDrawerMachine(null); setIsMobileMenuOpen(false) }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === 'blocking' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <ShieldX size={18} /> Website & Apps
              </button>
              <button
                onClick={() => { setActiveTab('safety'); setSelectedDrawerMachine(null); setIsMobileMenuOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === 'safety' ? 'bg-red-700 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <ShieldAlert size={18} /> AI Safety
                {safetyAlerts.length > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {safetyAlerts.length > 99 ? '99+' : safetyAlerts.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setActiveTab('reports'); setSelectedDrawerMachine(null); setIsMobileMenuOpen(false) }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === 'reports' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <BarChart3 size={18} /> Reports
              </button>
              <button
                onClick={() => { setActiveTab('users'); setSelectedDrawerMachine(null); setIsMobileMenuOpen(false) }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === 'users' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <UserCircle2 size={18} /> Users
              </button>
              <button
                onClick={() => { setActiveTab('settings'); setSelectedDrawerMachine(null); setIsMobileMenuOpen(false) }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === 'settings' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <SettingsIcon size={18} /> Settings
              </button>
            </div>
            
            <div className="pt-4 border-t border-slate-900 space-y-2">
              <div className="text-[10px] text-slate-500">
                Operator: <span className="text-slate-300 font-semibold">{currentUser?.username}</span>
              </div>
              <button
                onClick={() => { handleSignOut(); setIsMobileMenuOpen(false) }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/40 hover:bg-red-900/20 text-red-400 rounded-lg text-xs font-semibold border border-red-900/20 transition-colors"
              >
                <Power size={12} /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Remote Control QR Code Modal */}
      {isQrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-xs overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <div className="flex items-center gap-2">
                <Smartphone className="text-emerald-500" size={18} />
                <h3 className="text-sm font-bold text-white">Mobile Remote Control</h3>
              </div>
              <button 
                type="button" 
                onClick={() => setIsQrModalOpen(false)} 
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Toggle tabs for Local vs Public URL */}
            <div className="flex border-b border-slate-800 bg-slate-950/30">
              <button
                type="button"
                onClick={() => setQrMode('public')}
                disabled={!publicUrl}
                className={`flex-1 py-2 text-xs font-bold transition-colors ${
                  qrMode === 'public'
                    ? 'border-b-2 border-emerald-500 text-emerald-450'
                    : 'text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:hover:text-slate-400'
                }`}
              >
                Public Internet
              </button>
              <button
                type="button"
                onClick={() => setQrMode('lan')}
                className={`flex-1 py-2 text-xs font-bold transition-colors ${
                  qrMode === 'lan'
                    ? 'border-b-2 border-emerald-500 text-emerald-450'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Local Wi-Fi
              </button>
            </div>
            
            <div className="p-5 flex flex-col items-center text-center space-y-4">
              <div className="bg-white p-3 rounded-lg shadow-inner">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                    qrMode === 'public' && publicUrl ? publicUrl : `http://${serverIp}:9001`
                  )}`}
                  alt="QR Code"
                  className="w-[200px] h-[200px] block"
                />
              </div>
              
              <div className="space-y-1.5 w-full">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Scan QR Code or Open URL</span>
                <div className="bg-slate-950 border border-slate-850 px-3 py-1.5 rounded font-mono text-xs text-emerald-450 break-all select-all">
                  {qrMode === 'public' && publicUrl ? publicUrl : `http://${serverIp}:9001`}
                </div>
              </div>
              
              <p className="text-[11px] text-slate-450 leading-relaxed">
                {qrMode === 'public'
                  ? 'Access the control panel from anywhere in the world using your mobile internet or external networks.'
                  : 'Connect your mobile phone or tablet to the same local network (Wi-Fi) to control from inside the room.'
                }
              </p>
            </div>

            <div className="p-3 border-t border-slate-800 flex justify-end bg-slate-950/20">
              <button
                type="button"
                onClick={() => setIsQrModalOpen(false)}
                className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Fullscreen Remote Viewport Overlay */}
      {isRemoteFullscreen && selectedDrawerMachine && (
        <div 
          ref={fullscreenContainerRef}
          tabIndex={0}
          onKeyDown={(e) => handleFullscreenKeyDown(e, selectedDrawerMachine.id)}
          className="fixed inset-0 z-50 bg-slate-950 flex flex-row focus:outline-none select-none"
        >
          {/* Left: Main mirror viewport */}
          <div className="flex-1 flex flex-col h-full bg-slate-900/10">
            {/* Top Info Bar */}
            <div className="bg-slate-950/90 border-b border-slate-900 p-3 flex justify-between items-center text-xs">
              <div className="flex items-center gap-4">
                <span className="font-bold text-white text-sm">Remote Mirror: {selectedDrawerMachine.name}</span>
                <span className="text-slate-400 font-mono">IP: {selectedDrawerMachine.metrics?.ip || selectedDrawerMachine.ip_address || 'Offline'}</span>
                <span className="text-slate-400 font-mono">Res: {selectedDrawerMachine.metrics?.resolution?.width || 1920}x{selectedDrawerMachine.metrics?.resolution?.height || 1080}</span>
                <span className="text-slate-400">({selectedDrawerMachine.metrics?.os || 'Unknown'})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded border border-slate-800 text-slate-300">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Zoom:</span>
                  <select
                    value={zoomLevel}
                    onChange={(e) => setZoomLevel(e.target.value as any)}
                    className="bg-transparent text-white font-bold outline-none cursor-pointer text-xs"
                  >
                    <option value="fit" className="bg-slate-950 text-white">Fit Screen</option>
                    <option value="100" className="bg-slate-950 text-white">100% (Original)</option>
                    <option value="150" className="bg-slate-950 text-white">150% Zoom</option>
                    <option value="200" className="bg-slate-950 text-white">200% Zoom</option>
                  </select>
                </div>
                <button
                  onClick={() => handleCaptureScreenshot(selectedDrawerMachine.id)}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded font-bold transition-all flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Refresh
                </button>
                <button
                  onClick={() => {
                    setIsRemoteFullscreen(false)
                    if (window.ipcRenderer && selectedDrawerMachine) {
                      window.ipcRenderer.invoke('set-fullscreen-mirror', null).catch(() => {})
                    }
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded font-bold transition-all flex items-center gap-1"
                >
                  <Minimize2 size={12} /> Exit Fullscreen
                </button>
              </div>
            </div>

            {/* Mirror Frame Wrapper */}
            <div className={`flex-1 flex ${zoomLevel === 'fit' ? 'justify-center items-center overflow-hidden' : 'justify-start items-start overflow-auto'} p-2 relative bg-slate-950 cursor-crosshair`}>
              {(() => {
                if (!(screenFrames[selectedDrawerMachine.id] || screenshotBase64)) {
                  return (
                    <div className="text-center p-6 space-y-3 w-full">
                      <Loader2 size={36} className="animate-spin text-blue-500 mx-auto" />
                      <div className="text-sm text-slate-400">Requesting client mirror stream...</div>
                    </div>
                  );
                }

                const resolution = selectedDrawerMachine?.metrics?.resolution || { width: 1920, height: 1080 };
                const zoomWidth = zoomLevel === 'fit' ? undefined : (zoomLevel === '100' ? resolution.width : zoomLevel === '150' ? resolution.width * 1.5 : resolution.width * 2);
                const zoomHeight = zoomLevel === 'fit' ? undefined : (zoomLevel === '100' ? resolution.height : zoomLevel === '150' ? resolution.height * 1.5 : resolution.height * 2);

                return (
                  <img 
                    src={screenFrames[selectedDrawerMachine.id] 
                      ? `data:image/jpeg;base64,${screenFrames[selectedDrawerMachine.id]}` 
                      : `data:image/png;base64,${screenshotBase64}`
                    } 
                    alt="Client Remote Mirror Fullscreen" 
                    className={zoomLevel === 'fit' ? "w-full h-full object-contain pointer-events-auto shadow-2xl" : "pointer-events-auto shadow-2xl"}
                    style={zoomLevel === 'fit' ? {} : { width: `${zoomWidth}px`, height: `${zoomHeight}px`, maxWidth: 'none', maxHeight: 'none' }}
                    onMouseDown={(e) => handleMouseDown(e, selectedDrawerMachine.id)}
                    onMouseMove={(e) => handleMouseMove(e, selectedDrawerMachine.id)}
                    onMouseUp={(e) => handleMouseUp(e, selectedDrawerMachine.id)}
                    onDoubleClick={(e) => handleDoubleClick(e, selectedDrawerMachine.id)}
                    onContextMenu={(e) => e.preventDefault()}
                    onDragStart={(e) => e.preventDefault()}
                  />
                );
              })()}
              {/* Keyboard Indicator */}
              <div className="absolute bottom-3 right-3 bg-blue-950/90 text-[10px] text-blue-300 px-3 py-1.5 border border-blue-900/60 rounded-full font-mono shadow-md pointer-events-none">
                Keyboard control active. Press ESC to exit.
              </div>
              {/* Floating Zoom Pill — always visible even when scrolled deep into zoomed view */}
              {zoomLevel !== 'fit' && (
                <div
                  className="fixed bottom-6 left-1/2 z-50 flex items-center gap-1.5 bg-slate-900/95 border border-slate-700 rounded-full px-3 py-1.5 shadow-2xl backdrop-blur-sm"
                  style={{ transform: 'translateX(-50%)' }}
                >
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Zoom</span>
                  <button
                    onClick={() => setZoomLevel('fit')}
                    className="px-2 py-0.5 text-[11px] font-bold text-emerald-400 hover:text-white hover:bg-emerald-600 rounded-full transition-all"
                    title="Fit Screen (reset zoom)"
                  >Fit</button>
                  <div className="w-px h-3 bg-slate-700" />
                  {(['fit','100','150','200'] as const).map(lvl => (
                    <button
                      key={lvl}
                      onClick={() => setZoomLevel(lvl)}
                      className={`px-2 py-0.5 text-[11px] font-bold rounded-full transition-all ${zoomLevel === lvl ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                    >{lvl === 'fit' ? 'Fit' : `${lvl}%`}</button>
                  ))}
                  <div className="w-px h-3 bg-slate-700" />
                  <button
                    onClick={() => {
                      const levels: Array<'fit'|'100'|'150'|'200'> = ['fit','100','150','200']
                      const idx = levels.indexOf(zoomLevel)
                      if (idx > 0) setZoomLevel(levels[idx - 1])
                    }}
                    className="px-2 py-0.5 text-[11px] font-bold text-slate-300 hover:bg-slate-700 rounded-full transition-all"
                    title="Zoom Out (−)"
                  >−</button>
                  <button
                    onClick={() => {
                      const levels: Array<'fit'|'100'|'150'|'200'> = ['fit','100','150','200']
                      const idx = levels.indexOf(zoomLevel)
                      if (idx < levels.length - 1) setZoomLevel(levels[idx + 1])
                    }}
                    className="px-2 py-0.5 text-[11px] font-bold text-slate-300 hover:bg-slate-700 rounded-full transition-all"
                    title="Zoom In (+)"
                  >+</button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Remote operations & Console panel */}
          <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col h-full overflow-y-auto p-3.5 space-y-3.5">
            <div className="pb-2.5 border-b border-slate-800">
              <h4 className="font-bold text-white text-sm">Remote Control Panel</h4>
              <p className="text-[10px] text-slate-450 mt-0.5">Control tools for the current session.</p>
            </div>

            {/* Sys stats */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-450">System Meters</div>
              <div className="space-y-2 bg-slate-950/50 rounded-lg p-2.5 border border-slate-800/40 text-xs">
                <div>
                  <div className="flex justify-between text-[11px] font-mono mb-1 text-slate-350">
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
                <div>
                  <div className="flex justify-between text-[11px] font-mono mb-1 text-slate-350">
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
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-450">Active Window</div>
                <div className="bg-slate-950/60 p-2 rounded border border-slate-800 text-[11px] font-mono text-slate-300 truncate" title={selectedDrawerMachine.metrics?.activeWindow}>
                  {selectedDrawerMachine.metrics?.activeWindow || 'No active window reported'}
                </div>
              </div>
            )}

            {/* Terminal Panel */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-455 flex items-center gap-1">
                <Terminal size={12} className="text-blue-400" /> Remote Console CMD
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-900 text-[10px] font-mono text-slate-300 h-28 overflow-y-auto space-y-1">
                {commandOutput ? (
                  <pre className="whitespace-pre-wrap select-text">{commandOutput}</pre>
                ) : (
                  <span className="text-slate-650">Ready to execute console commands on client...</span>
                )}
              </div>
              <form 
                onSubmit={(e) => { e.preventDefault(); handleExecuteCommand(selectedDrawerMachine.id); }} 
                className="flex gap-1"
              >
                <input
                  type="text"
                  placeholder="cmd.exe command..."
                  className="flex-1 bg-slate-950 border border-slate-800 focus:border-blue-500 rounded px-2 py-1 text-xs text-white outline-none transition-colors font-mono"
                  value={commandLine}
                  onChange={(e) => setCommandLine(e.target.value)}
                  disabled={isExecutingCommand}
                />
                <button
                  type="submit"
                  disabled={isExecutingCommand || !commandLine.trim()}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded text-xs font-bold transition-all"
                >
                  {isExecutingCommand ? '...' : 'Run'}
                </button>
              </form>
            </div>

            {/* Actions */}
            <div className="space-y-1.5 pt-1.5 border-t border-slate-850">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-450">Control Actions</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => handleRestart(selectedDrawerMachine.id)}
                  className="py-1 px-1.5 bg-blue-900/30 hover:bg-blue-800/50 border border-blue-800/40 text-blue-300 hover:text-blue-200 rounded text-xs font-bold transition-all"
                >
                  Restart
                </button>
                <button
                  onClick={() => handlePower(selectedDrawerMachine.id)}
                  className="py-1 px-1.5 bg-red-900/30 hover:bg-red-800/50 border border-red-800/40 text-red-400 hover:text-red-350 rounded text-xs font-bold transition-all"
                >
                  Shutdown
                </button>
                <button
                  onClick={() => handleMsgClick(selectedDrawerMachine.id)}
                  className="col-span-2 py-1 px-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-200 hover:text-white rounded text-xs font-bold transition-all"
                >
                  Send Operator Message
                </button>
                <button
                  onClick={() => handleToggleHardwareLock(selectedDrawerMachine.id, !selectedDrawerMachine.hardware_locked)}
                  className={`col-span-2 py-1 px-1.5 border rounded text-xs font-bold transition-all ${
                    selectedDrawerMachine.hardware_locked
                      ? 'bg-red-950/45 hover:bg-red-900/40 border-red-800/60 text-red-400'
                      : 'bg-slate-800 hover:bg-slate-700 border-slate-700/60 text-slate-200 hover:text-white'
                  }`}
                >
                  {selectedDrawerMachine.hardware_locked ? '🔓 Unlock Physical Inputs' : '🔒 Block Physical Inputs'}
                </button>
              </div>
            </div>

            {/* Exit button */}
            <button
              onClick={() => {
                setIsRemoteFullscreen(false)
                if (window.ipcRenderer && selectedDrawerMachine) {
                  window.ipcRenderer.invoke('set-fullscreen-mirror', null).catch(() => {})
                }
              }}
              className="w-full mt-auto py-1.5 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 hover:text-white font-bold rounded text-xs transition-colors"
            >
              Minimize Viewport
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
