export const magnitudeColor = (magnitude: number) =>
  magnitude >= 6
    ? "#e99aab"
    : magnitude >= 5
      ? "#e9a070"
      : magnitude >= 4
        ? "#e9c48b"
        : "#9bbbd4";
