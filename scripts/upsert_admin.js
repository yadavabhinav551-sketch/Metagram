import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

async function main() {
  const appUri = process.argv[2] || process.env.MONGODB_URI;
  const adminUri = process.argv[3] || process.env.MONGODB_ADMIN_URI;
  const appDbName = process.env.MONGODB_DB || "metagram";
  const appCollectionName = process.env.MONGODB_COLLECTION || "app_state";
  const adminDbName = process.env.MONGODB_ADMIN_DB || "metagram_admin";
  const adminCollectionName = process.env.MONGODB_ADMIN_COLLECTION || "admin_state";

  if (!appUri && !adminUri) {
    console.error("Provide at least one of: app MONGODB URI (arg1 or MONGODB_URI) or admin MONGODB URI (arg2 or MONGODB_ADMIN_URI)");
    process.exit(1);
  }

  const desired = {
    loginId: "6388391842",
    email: "yadavabhinav551@gmail.com",
    passwordPlain: "1234546"
  };

  const passwordHash = await bcrypt.hash(desired.passwordPlain, 10);
  const adminDoc = {
    loginId: desired.loginId,
    email: desired.email,
    passwordHash,
    updatedAt: new Date().toISOString(),
    secretCodeLoginEnabled: false,
    hiddenAdminConversationIds: [],
    updateNotify: { enabled: false, version: 1, message: "Please update the app to continue.", updatedAt: null }
  };

  if (appUri) {
    console.log("Connecting to app DB...");
    const client = new MongoClient(appUri, { useNewUrlParser: true, useUnifiedTopology: true });
    try {
      await client.connect();
      const db = client.db(appDbName);
      const col = db.collection(appCollectionName);
      const existing = await col.findOne({ key: "main" });
      if (existing) {
        existing.admin = { ...existing.admin, ...adminDoc };
        await col.replaceOne({ key: "main" }, existing, { upsert: true });
        console.log("Updated admin in app collection.");
      } else {
        await col.insertOne({ key: "main", admin: adminDoc });
        console.log("Inserted new main document with admin in app collection.");
      }
    } catch (err) {
      console.error("App DB error:", err && err.message ? err.message : err);
    } finally {
      await client.close();
    }
  }

  if (adminUri) {
    console.log("Connecting to admin DB...");
    const client = new MongoClient(adminUri, { useNewUrlParser: true, useUnifiedTopology: true });
    try {
      await client.connect();
      const db = client.db(adminDbName);
      const col = db.collection(adminCollectionName);
      await col.replaceOne({ key: "main" }, { key: "main", admin: adminDoc }, { upsert: true });
      console.log("Upserted admin document in admin collection.");
    } catch (err) {
      console.error("Admin DB error:", err && err.message ? err.message : err);
    } finally {
      await client.close();
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
