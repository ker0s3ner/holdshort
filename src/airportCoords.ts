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
  // Europe
  EGLL: [51.47, -0.4543],
  EGKK: [51.1481, -0.1903],
  EGCC: [53.3537, -2.275],
  EDDF: [50.0379, 8.5622],
  ENGM: [60.1939, 11.1004],
  ESSA: [59.6519, 17.9186],
  EFHK: [60.3172, 24.9633],
  EKCH: [55.618, 12.656],
  EETN: [59.4133, 24.8328],
  EVRA: [56.9236, 23.9711],
  EYVI: [54.6341, 25.2858],
  EIDW: [53.4213, -6.2701],
  // Turkey / UAE
  LTFM: [41.2753, 28.7519],
  OMDB: [25.2532, 55.3657],
  // Japan
  RJTT: [35.5533, 139.7811],
  RJAA: [35.772, 140.3929],
  RJBB: [34.4347, 135.244],
  RJCC: [42.7752, 141.6923],
};
