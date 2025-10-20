import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import kardexRoutes from './routes/kardexRoutes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Rutas y lógica de la aplicación
app.use("/kardex", kardexRoutes);

export default app;