import { UiModel } from '../model/types';

export function serializeUiXml(ui: UiModel): string {
    const lines: string[] = [
        '<?xml version="1.0"?>',
        `<UI version="${ui.version}">`,
    ];
    for (const [id, layout] of Object.entries(ui.entities)) {
        const coords = layout.coordinates.join(' ');
        lines.push(`  <Entity id="${id}">`);
        lines.push(`    <Taste coordinates="${coords}"/>`);
        lines.push(`  </Entity>`);
    }
    lines.push('</UI>');
    return lines.join('\n');
}
