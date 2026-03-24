import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";
dotenv.config();
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "Resolve-X",   
 password: process.env.DB_PASSWORD,
  port: 5432,
});


const categories = ["Drainage", "Road", "Garbage", "Electricity"];
const statuses = ["Pending", "In Progress", "Resolved"];

const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

const getRandomDate = () => {
  const now = new Date();
  const past = new Date();
  past.setDate(now.getDate() - 60);
  return new Date(
    past.getTime() + Math.random() * (now.getTime() - past.getTime())
  );
};

const getRandomLocation = () => ({
  lat: 22.5 + Math.random() * 0.2,
  lng: 88.3 + Math.random() * 0.2,
});

const seedData = async () => {
  try {
    console.log("⏳ Seeding started...");

    for (let i = 0; i < 200; i++) {
      const loc = getRandomLocation();

      await pool.query(
        `INSERT INTO complaints 
        (title, description, category, priority, status, lat, lng, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          "Civic Issue",
          "Auto-generated complaint",
          getRandom(categories),
          Math.floor(Math.random() * 5) + 1,
          getRandom(statuses),
          loc.lat,
          loc.lng,
          getRandomDate(),
        ]
      );
    }

    console.log("🔥 DONE: 200 complaints inserted");
    process.exit();
  } catch (err) {
    console.error("❌ ERROR:", err);
    process.exit(1);
  }
};

seedData();