import { CloudOff } from 'lucide-react'

interface Props {
  title?: string
  description?: string
}

export function EmptyState({
  title = 'No data yet',
  description = 'Sync your Garmin data to see your health metrics.',
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-5">
        <CloudOff size={32} className="text-white/20" />
      </div>
      <h3 className="text-lg font-semibold text-white/60 mb-2">{title}</h3>
      <p className="text-sm text-white/30 leading-relaxed">{description}</p>
    </div>
  )
}
