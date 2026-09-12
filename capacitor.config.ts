import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.timetable.mobile',
  appName: '课表助手',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#F4F5F7',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_timetable',
      iconColor: '#1677FF',
    },
  },
};

export default config;
