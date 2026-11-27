import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors as c } from '../theme';
import { signalIcons } from '../sentinel/rules';
import type { SignalId } from '../sentinel/types';

export function SignalIcon({ id, threat }: { id: SignalId; threat: boolean }) {
  const kind = signalIcons[id];
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={threat ? c.threatSoft : c.muted} strokeWidth={1.5} accessible={false}>
    {kind === 'clock' ? <><Circle cx={12} cy={12} r={9} /><Path d="M12 6v6l4 2" /></>
      : kind === 'copy' ? <><Rect x={8} y={8} width={12} height={12} /><Path d="M16 8V4H4v12h4" /></>
      : kind === 'share' ? <><Rect x={3} y={3} width={18} height={18} /><Path d="M3 14h8V3m0 11 10 7" /></>
      : kind === 'moon' ? <Path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />
      : kind === 'report' ? <><Path d="m12 3 10 18H2L12 3Z M12 9v5m0 3v1" /></>
      : <><Circle cx={12} cy={12} r={8} /><Path d="M12 1v6m0 10v6M1 12h6m10 0h6" /></>}
  </Svg>;
}
