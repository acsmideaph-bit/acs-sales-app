// Reference lists. Suggestions only -- inputs still accept free text so a
// missing option never blocks a KAM in the field. Confirm the ACS lists for
// Dealer Classification and Channel (open question in docs/INTERPRETATION.md).

export const PH_REGIONS = [
  'NCR', 'CAR', 'Region I - Ilocos', 'Region II - Cagayan Valley', 'Region III - Central Luzon',
  'Region IV-A - CALABARZON', 'MIMAROPA', 'Region V - Bicol', 'Region VI - Western Visayas',
  'NIR - Negros Island', 'Region VII - Central Visayas', 'Region VIII - Eastern Visayas',
  'Region IX - Zamboanga Peninsula', 'Region X - Northern Mindanao', 'Region XI - Davao',
  'Region XII - SOCCSKSARGEN', 'Region XIII - Caraga', 'BARMM',
]

export const DEALER_CLASSIFICATIONS = ['Key Dealer', 'Regular Dealer', 'Accredited Dealer', 'Service Center Dealer', 'Prospect']
export const CHANNELS = ['Dealer', 'Distributor', 'Appliance Center', 'Aircon Specialist Shop', 'Contractor', 'Project / End-user']
export const PRIORITIES = [
  { value: 'A', label: 'A - High' },
  { value: 'B', label: 'B - Medium' },
  { value: 'C', label: 'C - Low' },
]
