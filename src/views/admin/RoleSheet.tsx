import React from 'react';
import { View } from 'react-native';
import { PICKER_ROLES, isManagement, roleChangeKey } from '../../client/roles.ts';
import type { MemberRow, Role } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Sheet } from '../../kit/components.tsx';
import { Choice } from './shared.tsx';

/** UX-DESIGN §20.4: "התפקיד של {name}". Any manager sees all three roles. Returns the error text, or null on success. */
export function RoleSheet({ row, self, onClose, onSave }: { row: MemberRow | null; self: boolean; onClose: () => void; onSave: (role: Role) => Promise<string | null> }) {
  const { t } = useI18n();
  const [chosen, setChosen] = React.useState<Role>('member');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setChosen(row?.role ?? 'member'); setError(null); }, [row?.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const same = chosen === row?.role;
  const leaves = self && isManagement(row?.role) && !isManagement(chosen);
  return (
    <Sheet visible={!!row} title={t('admin.role.title', { name: row?.displayName ?? '' })} onClose={onClose}
      footer={<Button title={t(roleChangeKey(chosen))} disabled={same} busy={busy}
        onPress={() => { setBusy(true); setError(null); void onSave(chosen).then(e => { setBusy(false); if (e) setError(e); }); }} />}>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {PICKER_ROLES.map(r => <Choice key={r} label={t(`admin.role.${r}`)} note={t(`admin.role.${r}Note`)} selected={chosen === r} onPress={() => { setChosen(r); setError(null); }} />)}
      </View>
      {leaves ? <Banner tone="info" text={t('admin.role.self')} /> : null}
      {error ? <Banner tone="error" text={error} /> : null}
    </Sheet>
  );
}
