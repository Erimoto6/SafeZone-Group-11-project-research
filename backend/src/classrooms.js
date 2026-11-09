// Actual classroom numbers in this building; clinic, offices and library excluded.
const EXCLUDED = new Set([108, 205, 210, 307, 309]);
function isClassroom(floor, number) {
  return Number.isInteger(floor) && floor >= 1 && floor <= 4 &&
    Number.isInteger(number) && number >= floor * 100 + 1 && number <= floor * 100 + 12 && !EXCLUDED.has(number);
}
module.exports = { isClassroom };
