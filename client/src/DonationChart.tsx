import { Area, AreaChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type DonationChartRow = { month: string; amount: number; donations: number }

type DonationChartProps = {
  rows: DonationChartRow[]
  mode: string
  onActiveMonthChange: (monthIndex: number) => void
}

export default function DonationChart({ rows, mode, onActiveMonthChange }: DonationChartProps) {
  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={rows} onMouseMove={(state) => {
      if (typeof state.activeTooltipIndex === 'number') onActiveMonthChange(state.activeTooltipIndex)
    }} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
      <defs><linearGradient id="givingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5e3c" stopOpacity={0.2} /><stop offset="95%" stopColor="#8b5e3c" stopOpacity={0.01} /></linearGradient></defs>
      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#eee6dc" />
      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#8f8378', fontSize: 11 }} />
      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8f8378', fontSize: 10 }} tickFormatter={(value) => `${value / 1000}k`} />
      <Tooltip />
      <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
      {mode !== 'Donation count' && <Area type="monotone" dataKey="amount" name="Offering amount" stroke="#8b5e3c" fill="url(#givingFill)" strokeWidth={2.5} />}
      {mode !== 'Amount (₱)' && <Line type="monotone" dataKey="donations" name="Confirmed donations" stroke="#729278" strokeWidth={2.5} dot={{ r: 3 }} />}
    </AreaChart>
  </ResponsiveContainer>
}
