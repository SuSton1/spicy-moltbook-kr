import SettingsTabs from "@/components/settings/SettingsTabs"

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="container km-settings">
      <div className="km-settings-layout">
        <SettingsTabs />
        <div className="km-settings-content">{children}</div>
      </div>
    </div>
  )
}
