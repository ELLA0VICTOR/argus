import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Linking, Platform } from 'react-native';
import { ALERT_CHANNEL, alertIdFromPush, alertIdFromUrl } from '../sentinel/rules';

Notifications.setNotificationHandler({ handleNotification: async () => ({
  shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
}) });

export async function createAlertChannel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
    name: 'Argus alerts', importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250], sound: 'default',
  });
}

async function requestPermission() {
  await createAlertChannel(); // Android requires the channel before its notification permission prompt.
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Allow notifications in Android settings, then try again.');
}

export async function getExpoPushToken(): Promise<string> {
  if (Platform.OS !== 'android' || !Device.isDevice) throw new Error('Push alerts require a physical Android phone.');
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Link this app to an EAS project before registering push alerts.');
  await requestPermission();
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export async function showLocalAlertPreview(id: string, vault: string) {
  await requestPermission();
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Argus: sample withdrawal alert', body: 'Tap to review the sample alert. No transaction will be signed.',
      data: { type: 'withdrawal_alert', alert_id: id, vault, url: `argus://alert/${id}` }, sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: ALERT_CHANNEL },
  });
}

export function listenForAlerts(onAlert: (id: string) => void, onError: (message: string) => void) {
  let active = true;
  const seen = new Set<string>();
  const response = (value: Notifications.NotificationResponse | null) => {
    if (!active || !value || value.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = value.notification.request.identifier;
    if (seen.has(key)) return;
    seen.add(key);
    const id = alertIdFromPush(value.notification.request.content.data);
    if (id) onAlert(id);
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  };
  const notificationSubscription = Notifications.addNotificationResponseReceivedListener(response);
  // While foregrounded, an authenticated alert fetch can open the incoming-call screen immediately.
  const receivedSubscription = Notifications.addNotificationReceivedListener(notification => {
    if (!active || notification.request.content.data?.type !== 'withdrawal_alert' || seen.has(notification.request.identifier)) return;
    const id = alertIdFromPush(notification.request.content.data);
    if (id) { seen.add(notification.request.identifier); onAlert(id); }
  });
  const linkSubscription = Linking.addEventListener('url', event => {
    const id = alertIdFromUrl(event.url); if (active && id) onAlert(id);
  });
  void Notifications.getLastNotificationResponseAsync().then(response).catch(() => { if (active) onError('Could not read the notification. Open Alerts to retry.'); });
  void Linking.getInitialURL().then(url => { const id = alertIdFromUrl(url); if (active && id) onAlert(id); })
    .catch(() => { if (active) onError('Could not open the alert link. Open Alerts to retry.'); });
  void createAlertChannel().catch(() => { if (active) onError('Could not create the alert notification channel.'); });
  return () => { active = false; notificationSubscription.remove(); receivedSubscription.remove(); linkSubscription.remove(); };
}
