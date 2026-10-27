import React from 'react';
import { ScrollView } from 'react-native';
import type { ScrollViewProps } from 'react-native';
import { useReportPad } from '../client/reportUi.ts';

/** A ScrollView whose content keeps 56 px free at the bottom while the report button can show (UX-DESIGN §13.1). */
export const PadScroll = React.forwardRef<ScrollView, ScrollViewProps>(function PadScroll({ contentContainerStyle, ...rest }, ref) {
  const pad = useReportPad();
  return <ScrollView ref={ref} {...rest} contentContainerStyle={[contentContainerStyle, pad ? { paddingBottom: pad } : null]} />;
});
