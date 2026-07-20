import * as React from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { SessionStorageKind } from '@/sync/domains/session/sessionStorageKind';
import { t } from '@/text';
import { SessionListStorageTabsBar } from './SessionListStorageTabsBar';
import { isLocalDevPilotDesktopMode } from '@/config/devpilotLocalSession';
import { devPilotDesktopActions } from '@/devpilot/domain/hooks';

const stylesheet = StyleSheet.create(() => ({
    browseActionContainer: {
        marginTop: -4,
    },
    browseActionGroupSurface: {
        backgroundColor: 'transparent',
        boxShadow: 'none',
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
}));

export type SessionsListStorageChromeProps = Readonly<{
    directSessionsEnabled: boolean;
    storageKind: SessionStorageKind;
    onSelectStorageKind: (storageKind: SessionStorageKind) => void;
}>;

export const SessionsListStorageChrome = React.memo((props: SessionsListStorageChromeProps) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [openingProjectFolder, setOpeningProjectFolder] = React.useState(false);
    const mountedRef = React.useRef(true);
    const localDevPilot = isLocalDevPilotDesktopMode();
    const showDirectBrowseAction = props.directSessionsEnabled && props.storageKind === 'direct';

    React.useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    const handleOpenProjectFolder = React.useCallback(() => {
        if (openingProjectFolder) return;
        setOpeningProjectFolder(true);
        void (async () => {
            try {
                await devPilotDesktopActions.openProjectFolder();
            } catch {
                // The DevPilot store surfaces expected picker/runtime failures in
                // local state; keep this row from producing unhandled promise noise.
            } finally {
                if (mountedRef.current) {
                    setOpeningProjectFolder(false);
                }
            }
        })();
    }, [openingProjectFolder]);

    return (
        <>
            {localDevPilot ? (
                <ItemGroup
                    style={styles.browseActionContainer}
                    containerStyle={styles.browseActionGroupSurface}
                    constrainToContentWidth={false}
                >
                    <Item
                        testID="devpilot-open-folder-button"
                        title={openingProjectFolder ? 'Opening folder...' : 'Open Folder'}
                        subtitle={openingProjectFolder ? 'Waiting for project selection' : 'Choose a local project for DevPilot'}
                        icon={<Ionicons name="folder-open-outline" size={22} color={theme.colors.text.secondary} />}
                        loading={openingProjectFolder}
                        disabled={openingProjectFolder}
                        onPress={handleOpenProjectFolder}
                    />
                </ItemGroup>
            ) : props.directSessionsEnabled ? (
                <SessionListStorageTabsBar
                    activeTabId={props.storageKind}
                    onSelectTab={props.onSelectStorageKind}
                />
            ) : null}
            {showDirectBrowseAction ? (
                <ItemGroup
                    style={styles.browseActionContainer}
                    containerStyle={styles.browseActionGroupSurface}
                    constrainToContentWidth={false}
                >
                    <Item
                        testID="direct-sessions-browse-button"
                        title={t('directSessions.browseOpenExisting')}
                        subtitle={t('directSessions.browseActionSubtitle')}
                        icon={<Ionicons name="folder-open-outline" size={22} color={theme.colors.text.secondary} />}
                        onPress={() => {
                            router.push('/direct/browse');
                        }}
                    />
                </ItemGroup>
            ) : null}
        </>
    );
});
