// Ready-made size ranges (BE6, Story 1.2), kept as DATA, not code: adding a
// range is adding an entry here. GET /api/reference sends them to the phone,
// which turns a chosen range ("shoes 30 to 40") into individual sizes, each
// pushed with size.upsert and its position (sortOrder) in the range, so sizes
// always show in their natural order (30, 31 … 40; S, M, L), never
// alphabetically. The server only ever stores individual sizes.

// Each range: a code, the name to show, the product types it's offered for,
// and its sizes in their natural order.
const SIZE_RANGES = Object.freeze([
  {
    code: 'shoes_eu', name: 'Shoe sizes (30–46)', forTypes: ['shoes'],
    sizes: Array.from({ length: 17 }, (_, i) => String(30 + i)),
  },
  {
    code: 'clothing_letters', name: 'Clothing sizes (XS–XXXL)', forTypes: ['clothing'],
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
  },
  {
    code: 'children_years', name: "Children's ages (1Y–12Y)", forTypes: ['clothing', 'shoes'],
    sizes: Array.from({ length: 12 }, (_, i) => `${i + 1}Y`),
  },
]);

module.exports = { SIZE_RANGES };
