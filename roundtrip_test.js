const fs = require('fs');
const { IvXmlParser } = require('./.test-out/src/parsers/IvXmlParser.js');
const { IvXmlSerializer } = require('./.test-out/src/serializers/IvXmlSerializer.js');

function normalizeXml(xml) {
    return xml.replace(/>\s+</g, '><').replace(/<\?xml.*\?>/, '').trim();
}

const files = [
"references/kazoo/test/communication_device_test/CDSrcProj/interfaceview.xml",
"references/kazoo/test/communication_device_test/CDTargetProj/interfaceview.xml",
"references/kazoo/test/Demo_ACN/interfaceview.xml",
"references/kazoo/test/custom_build_step/interfaceview.xml",
"references/kazoo/test/RTEMS6_SMP_QDP-get-sender-demo/interfaceview.xml",
"references/kazoo/test/Demo_ABB_Opengeode/interfaceview.xml",
"references/kazoo/test/linux-cpp-one-2-n-demo/interfaceview.xml",
"references/kazoo/test/linux-cpp-one-2-n-sporadic/interfaceview.xml",
"references/kazoo/test/Demo_CoRA_BRAVE_Large_SW_Only/interfaceview.xml",
"references/kazoo/test/p3-downlink/interfaceview.xml",
"references/kazoo/test/linux-cpp-startup-priority-demo/interfaceview.xml",
"references/kazoo/test/communication_device_acn_test/CDSrcProj/interfaceview.xml",
"references/kazoo/test/communication_device_acn_test/CDTargetProj/interfaceview.xml",
"references/kazoo/test/RTEMS6_SMP_QDP-perf-mon/interfaceview.xml",
"references/kazoo/test/linux-cpp-timers/interfaceview.xml",
"references/kazoo/test/Demo_Blackbox/interfaceview.xml",
"references/kazoo/test/Demo_CoRA_MBAD_4ZYNQ_PrimeNumbers/interfaceview.xml",
"references/kazoo/test/acnEncodingWithBlackbox/interfaceview.xml",
"references/kazoo/test/RTEMS6_SMP_QDP-n-2-m-with-routing-table/interfaceview.xml",
"references/kazoo/test/test-error-reporting/test-error-reporting/interfaceview.xml",
"references/kazoo/test/Demo_ContextParams/interfaceview.xml",
"references/kazoo/test/linux-cpp-one-2-n-protected/interfaceview.xml",
"references/kazoo/test/pizza/interfaceview.xml",
"references/kazoo/test/instanceCpp/interfaceview.xml",
"references/kazoo/test/guis/interfaceview.xml",
"references/kazoo/test/test-generic-linux-many-to-one/interfaceview.xml",
"references/kazoo/test/e2es_complete/interfaceview.xml",
"references/kazoo/test/communication_device_only_broker_test/CDSrcProj/interfaceview.xml",
"references/kazoo/test/communication_device_only_broker_test/CDTargetProj/interfaceview.xml",
"references/kazoo/test/linux-get-sender-demo/interfaceview.xml",
"references/kazoo/test/ccsds_packetizer_communication/ccsds_packetizer_pro/interfaceview.xml",
"references/kazoo/test/n2n/interfaceview.xml",
"references/kazoo/test/test-create/interfaceview.xml",
"references/kazoo/test/linux-get-sender-with-broker-demo/interfaceview.xml",
"references/kazoo/test/passthrough_packetizer_communication/passthrough_packetizer_communication/interfaceview.xml",
"references/kazoo/test/Ada_Types/interfaceview.xml",
"references/kazoo/test/RTEMS6_SMP_QDP-n-2-m-demo/interfaceview.xml",
"references/kazoo/test/Demo_CoRA_BRAVE_Large_SW_and_Bambu/interfaceview.xml",
"references/kazoo/test/bigMessages/interfaceview.xml",
"references/kazoo/test/TrafficLight_Basic/interfaceview.xml"
];

let passCount = 0;
for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
        const original = fs.readFileSync(file, 'utf8');
        const parser = new IvXmlParser();
        const model = parser.parse(original);
        const serializer = new IvXmlSerializer();
        const reserialized = serializer.serialize(model);
        
        if (normalizeXml(original) === normalizeXml(reserialized)) {
            console.log(file);
            passCount++;
        }
    } catch (e) { }
}
if (passCount === 0) console.log("None passed");
