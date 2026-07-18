import * as React from 'react';
import { View } from 'react-native';

/**
 * The native workspace owns its conversation sidebar. This placeholder keeps
 * legacy hosted navigation routes from manufacturing a second data source.
 */
export const DevPilotProjectSidebar = React.memo(() => <View testID="devpilot-native-conversation-sidebar" />);
