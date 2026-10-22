/* ============ GLYPH LIBRARY ============ */
const ARROW='<path class="gs" d="M50 84 V22 M28 42 L50 20 L72 42"/>';
const KEEP='<path class="gs" d="M58 88 V56 a18 18 0 0 0 -18 -18 H26 M44 22 L22 38 L44 54"/><path class="gs" opacity=".26" d="M78 88 V28"/>';
const FORK='<path class="gs" d="M50 88 V58 M50 58 L26 28 M26 28 V44 M26 28 H42"/><path class="gs" opacity=".26" d="M50 58 L74 28"/>';
const MERGE='<path class="gs" d="M52 88 V44 M52 44 V22 M38 34 L52 20 L66 34"/><path class="gs" opacity=".32" d="M22 88 C22 62 52 62 52 46"/>';
const EXIT='<path class="gs" d="M38 88 V42 a16 16 0 0 1 16 -16 H76 M60 10 L80 26 L60 42"/>';
const ROUNDABOUT='<circle class="gs" cx="46" cy="44" r="22"/><path class="gs" d="M46 88 V66"/><path class="gs" d="M68 44 H90 M76 32 L90 44 L76 56"/>';
const REVERSE='<path class="gs" d="M34 88 V44 a18 18 0 0 1 36 0 V62 M54 48 L70 64 L86 48"/>';
const ARRIVE='<circle class="gs" cx="50" cy="50" r="12"/><circle class="gs" opacity=".28" cx="50" cy="50" r="32"/>';

const REC = {
  offroute:{n:'Off route',g:'<path class="gs" d="M20 88 V46 a18 18 0 0 1 18 -18 H84"/><circle cx="70" cy="76" r="11" fill="currentColor" stroke="none"/>',i:'Off route',c:'Rejoin the recorded route when safe'},
  missed:{n:'Turn missed',g:'<path class="gs" opacity=".28" d="M64 88 V46 a16 16 0 0 0 -16 -16 H28 M44 14 L24 30 L44 46"/><path class="gs" d="M22 80 L82 20"/>',i:'Turn missed',c:'New route found'},
  updated:{n:'Route updated',g:'<circle class="gs" cx="50" cy="50" r="34"/><path class="gs" d="M34 51 L45 63 L67 39"/>',i:'Route updated',c:'Avoiding a blocked lane'},
  signal:{n:'Signal weak',g:'<path class="gs" opacity=".28" d="M14 46 A52 52 0 0 1 86 46"/><path class="gs" opacity=".28" d="M27 60 A34 34 0 0 1 73 60"/><path class="gs" d="M39 73 A17 17 0 0 1 61 73"/><circle cx="50" cy="88" r="7" fill="currentColor" stroke="none"/>',i:'Signal weak',c:'Follow the road'},
  rerouting:{n:'Rerouting',g:'<path class="gs" d="M78 32 A32 32 0 1 0 82 50"/><path class="gs" d="M62 26 L80 30 L76 48"/>',i:'Finding a new route',c:'Continue for now'},
  blocked:{n:'Route blocked',g:'<circle class="gs" cx="50" cy="50" r="34"/><path class="gs" d="M32 50 H68"/>',i:'Route blocked',c:'Finding another way',unlocked:true},
  caution:{n:'Caution',g:'<path class="gs" d="M50 18 L88 84 H12 Z"/><path class="gs" d="M50 44 V62"/><circle cx="50" cy="74" r="5.5" fill="currentColor" stroke="none"/>',i:'Cycle lane blocked',c:'Reported by 3 riders today',unlocked:true}
};
