
const { Pool } = require('pg');
 
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                // max pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
 
pool.on('error', (err) => {
  console.error('Unexpected DB pool error', err);
});

async function runSeed(client = pool) {
  const demoComplaints = [
    {
      category: 'Drainage',
      subcategory: 'blocked_drain',
      description: 'Drainage overflow reported near demo ward market junction.',
      lng: 77.2096,
      lat: 28.6106,
      priority: 2,
    },
    {
      category: 'Roads',
      subcategory: 'pothole',
      description: 'Deep pothole near bus stop causing traffic slowdown.',
      lng: 77.2121,
      lat: 28.6122,
      priority: 3,
    },
    {
      category: 'Sanitation',
      subcategory: 'garbage_dump',
      description: 'Garbage pile-up near lane entrance requiring urgent pickup.',
      lng: 77.2062,
      lat: 28.6085,
      priority: 3,
    },
    {
      category: 'Electricity',
      subcategory: 'light_out',
      description: 'Streetlight outage reported on demo ward connector road.',
      lng: 77.2144,
      lat: 28.6179,
      priority: 3,
    },
    {
      category: 'Water Supply',
      subcategory: 'low_pressure',
      description: 'Residents reported low water pressure across multiple homes.',
      lng: 77.2039,
      lat: 28.6068,
      priority: 2,
    },
  ];

  const { rows } = await client.query(
    `INSERT INTO users (email, name, role, source, ward_id, city_id)
     VALUES ('demo@resolvex.in', 'Demo Citizen', 'citizen', 'demo_sandbox', 'DEMO_WARD', 'DEMO')
     ON CONFLICT (email) DO UPDATE SET source = 'demo_sandbox'
     RETURNING id`
  );

  const demoCitizenId = rows[0]?.id || null;

  for (const complaint of demoComplaints) {
    await client.query(
      `INSERT INTO complaints
         (citizen_id, category, subcategory, description, location,
          ward_id, status, priority, source, environment, officer_verified,
          sla_deadline, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326),
          'DEMO_WARD', 'pending', $7, 'demo_sandbox', 'sandbox', false,
          now() + interval '72 hours', now(), now())`,
      [
        demoCitizenId,
        complaint.category,
        complaint.subcategory,
        complaint.description,
        complaint.lng,
        complaint.lat,
        complaint.priority,
      ]
    );
  }

  return demoComplaints.length;
}
 
module.exports = pool;
module.exports.runSeed = runSeed;
 