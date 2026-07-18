import * as React from 'react';

import { DevPilotDesktopApp } from './DevPilotDesktopApp';

/** @deprecated The native desktop creates a conversation only on first send. */
export const DevPilotNewTaskScreen = React.memo(() => <DevPilotDesktopApp />);
