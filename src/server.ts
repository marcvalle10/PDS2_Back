import "reflect-metadata";
import 'dotenv/config';
import app from './main';
import { AppDataSource } from './config/data-source';

async function bootstrap() {
  const PORT = Number(process.env.PORT) || 5000;

  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log("✅ DB conectada");
    }
  } catch (err) {
    console.error("❌ Error al inicializar la DB:", err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
  });
}

// Evita arrancar dos veces en entornos con importaciones cíclicas
bootstrap().catch((e) => {
  console.error("❌ Bootstrap falló:", e);
  process.exit(1);
});

// Opcional: logging de errores globales
process.on('unhandledRejection', (reason) => {
  console.error('🔴 UnhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🔴 UncaughtException:', err);
  process.exit(1);
});
