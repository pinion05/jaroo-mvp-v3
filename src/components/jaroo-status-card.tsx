import { AlertCircle, CheckCircle2, Inbox, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const variantMap = {
  loading: {
    icon: Loader2,
    wrap: 'border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-ink)]',
    iconClass: 'text-[color:var(--jaroo-primary)] animate-spin',
    titleClass: 'text-[color:var(--jaroo-ink)]',
  },
  success: {
    icon: CheckCircle2,
    wrap: 'border-[color:var(--jaroo-success-soft)] bg-[color:var(--jaroo-success-ghost)] text-[color:var(--jaroo-success)]',
    iconClass: 'text-[color:var(--jaroo-success)]',
    titleClass: 'text-[color:var(--jaroo-success)]',
  },
  empty: {
    icon: Inbox,
    wrap: 'border-dashed border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
    iconClass: 'text-[color:var(--jaroo-muted)]',
    titleClass: 'text-[color:var(--jaroo-ink)]',
  },
  error: {
    icon: AlertCircle,
    wrap: 'border-[color:var(--jaroo-danger-soft)] bg-[color:var(--jaroo-danger-ghost)] text-[color:var(--jaroo-danger)]',
    iconClass: 'text-[color:var(--jaroo-danger)]',
    titleClass: 'text-[color:var(--jaroo-danger)]',
  },
} as const

export function JarooStatusCard({
  variant,
  title,
  description,
  className,
}: {
  variant: keyof typeof variantMap
  title: string
  description: string
  className?: string
}) {
  const config = variantMap[variant]
  const Icon = config.icon

  return (
    <Card className={cn('rounded-[20px] border px-4 py-3 shadow-none', config.wrap, className)}>
      <div className='flex items-start gap-3'>
        <div className='mt-0.5 rounded-full bg-white/70 p-2'>
          <Icon className={cn('size-4', config.iconClass)} />
        </div>
        <div className='space-y-1'>
          <p className={cn('text-sm font-semibold', config.titleClass)}>{title}</p>
          <p className='text-xs leading-5 text-current/80'>{description}</p>
        </div>
      </div>
    </Card>
  )
}
