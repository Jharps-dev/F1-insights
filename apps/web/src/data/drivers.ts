/**
 * Static 2023 F1 season driver lookup.
 * Maps driver number → {code, name, team, teamColor}.
 * Used for display when the manifest only carries generic "D{n}" codes.
 */

export interface DriverInfo {
  code: string;
  name: string;
  team: string;
  color: string; // team livery accent color
}

export const DRIVERS: Record<number, DriverInfo> = {
  1:  { code: "VER", name: "Max Verstappen",     team: "Red Bull Racing",  color: "#3671C6" },
  2:  { code: "SAR", name: "Logan Sargeant",      team: "Williams",         color: "#37BEDD" },
  4:  { code: "NOR", name: "Lando Norris",         team: "McLaren",          color: "#FF8000" },
  10: { code: "GAS", name: "Pierre Gasly",         team: "Alpine",           color: "#FF87BC" },
  11: { code: "PER", name: "Sergio Pérez",         team: "Red Bull Racing",  color: "#3671C6" },
  14: { code: "ALO", name: "Fernando Alonso",      team: "Aston Martin",     color: "#358C75" },
  16: { code: "LEC", name: "Charles Leclerc",      team: "Ferrari",          color: "#E8002D" },
  18: { code: "STR", name: "Lance Stroll",         team: "Aston Martin",     color: "#358C75" },
  20: { code: "MAG", name: "Kevin Magnussen",      team: "Haas",             color: "#B6BABD" },
  21: { code: "DEV", name: "Nyck de Vries",        team: "AlphaTauri",       color: "#5E8FAA" },
  22: { code: "TSU", name: "Yuki Tsunoda",         team: "AlphaTauri",       color: "#5E8FAA" },
  23: { code: "ALB", name: "Alexander Albon",      team: "Williams",         color: "#37BEDD" },
  24: { code: "ZHO", name: "Zhou Guanyu",          team: "Alfa Romeo",       color: "#C92D4B" },
  27: { code: "HUL", name: "Nico Hülkenberg",      team: "Haas",             color: "#B6BABD" },
  31: { code: "OCO", name: "Esteban Ocon",         team: "Alpine",           color: "#FF87BC" },
  40: { code: "LAW", name: "Liam Lawson",          team: "AlphaTauri",       color: "#5E8FAA" },
  44: { code: "HAM", name: "Lewis Hamilton",       team: "Mercedes",         color: "#27F4D2" },
  55: { code: "SAI", name: "Carlos Sainz",         team: "Ferrari",          color: "#E8002D" },
  63: { code: "RUS", name: "George Russell",       team: "Mercedes",         color: "#27F4D2" },
  77: { code: "BOT", name: "Valtteri Bottas",      team: "Alfa Romeo",       color: "#C92D4B" },
  81: { code: "PIA", name: "Oscar Piastri",        team: "McLaren",          color: "#FF8000" },
};

export function getDriver(number: number): DriverInfo {
  return (
    DRIVERS[number] ?? {
      code: `D${number}`,
      name: `Driver ${number}`,
      team: "Unknown",
      color: "#FFFFFF",
    }
  );
}
