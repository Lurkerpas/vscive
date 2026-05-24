import { UiModel } from '../model/types';
import { preferBracedId } from '../utils/id';

export function serializeUiXml(ui: UiModel): string {
    const lines: string[] = [
        '<?xml version="1.0"?>',
        `<UI version="${ui.version}">`,
    ];
    for (const [id, layout] of Object.entries(ui.entities)) {
        const coords = layout.coordinates.join(' ');
        const rcAttr = (layout.rootCoordinates?.length ?? 0) >= 2
            ? ` RootCoordinates="${layout.rootCoordinates!.join(' ')}"`
            : '';
        lines.push(`  <Entity id="${preferBracedId(id)}">`);
        lines.push(`    <Taste${rcAttr} coordinates="${coords}"/>`);
        lines.push(`  </Entity>`);
    }
    lines.push('</UI>');
    return lines.join('\n');
}
