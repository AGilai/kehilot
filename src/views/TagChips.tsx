import React from 'react';
import { View } from 'react-native';
import { sortTags, tagListLabel } from '../client/tagsView.ts';
import type { RoleTag } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Tag } from '../kit/components.tsx';

/** A wrapping row of role tags (gap 6). One text for screen readers, not one stop per tag. Renders nothing when empty. Labels only. */
export function TagChips({ tags }: { tags: RoleTag[] }) {
  const { t } = useI18n();
  if (tags.length === 0) return null;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={t('admin.tags.member.list', { list: tagListLabel(tags) })} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {sortTags(tags).map(x => <Tag key={x.tagId} label={x.name} tone="role" content />)}
    </View>
  );
}
