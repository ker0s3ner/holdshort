/** Real-world lat/lon for the ICAO codes the traffic generator can pick as
 * an "other airport" (origin/destination) - see the region pools in
 * crates/atc-core/src/traffic.rs. Kept in sync with that list. The
 * controlled airport's own coordinates come from AirportData.reference_point
 * directly and don't need a lookup here. */
export const AIRPORT_COORDS: Record<string, [number, number]> = {
  // US
  KLAX: [33.9425, -118.4081],
  KSFO: [37.6213, -122.379],
  KPHX: [33.4352, -112.0101],
  KDEN: [39.8561, -104.6737],
  KSEA: [47.4502, -122.3088],
  KSAN: [32.7338, -117.1933],
  KOAK: [37.7126, -122.2197],
  KLAS: [36.084, -115.1537],
  KJFK: [40.6413, -73.7781],
  KORD: [41.9742, -87.9073],
  KATL: [33.6407, -84.4277],
  KDFW: [32.8998, -97.0403],
  KBUR: [34.2007, -118.3585],
  // Europe
  EGLL: [51.47, -0.4543],
  EGKK: [51.1481, -0.1903],
  EGCC: [53.3537, -2.275],
  EGPH: [55.9500, -3.3725],
  EGBB: [52.4539, -1.7480],
  EGSS: [51.8850, 0.2350],
  EGPF: [55.8719, -4.4331],
  EGGW: [51.8747, -0.3683],
  EDDF: [50.0379, 8.5622],
  ENGM: [60.1939, 11.1004],
  ESSA: [59.6519, 17.9186],
  ESGG: [57.6628, 12.2798],
  ESMS: [55.5302, 13.3716],
  ESSB: [59.3544, 17.9417],
  EFHK: [60.3172, 24.9633],
  EFTP: [61.4141, 23.6044],
  EFRO: [66.5648, 25.8304],
  EKCH: [55.618, 12.656],
  EKBI: [55.7403, 9.1518],
  EETN: [59.4133, 24.8328],
  EVRA: [56.9236, 23.9711],
  EYVI: [54.6341, 25.2858],
  EYKA: [54.9639, 24.0848],
  EIDW: [53.4213, -6.2701],
  EICK: [51.8413, -8.4911],
  EINN: [52.7020, -8.9248],
  ENBR: [60.2934, 5.2181],
  ENVA: [63.4578, 10.9240],
  ENZV: [58.8767, 5.6378],
  // Turkey / UAE
  LTFM: [41.2753, 28.7519],
  OMDB: [25.2532, 55.3657],
  // Japan
  RJTT: [35.5533, 139.7811],
  RJAA: [35.772, 140.3929],
  RJBB: [34.4347, 135.244],
  RJCC: [42.7752, 141.6923],
};
