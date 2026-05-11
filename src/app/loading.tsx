export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] px-4 pt-14 pb-8 animate-pulse">
      {/* Header */}
      <div className="h-7 w-36 bg-white/8 rounded-xl mb-1" />
      <div className="h-4 w-24 bg-white/5 rounded-lg mb-6" />

      {/* Cards */}
      {[1, 2, 3].map(i => (
        <div key={i} className="h-28 bg-white/5 rounded-2xl mb-3" />
      ))}
      <div className="h-44 bg-white/5 rounded-2xl mb-3" />
      <div className="h-28 bg-white/5 rounded-2xl" />
    </div>
  )
}
