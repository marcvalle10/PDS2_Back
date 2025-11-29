import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import kardexRoutes from './routes/kardexRoutes';
import estructuraRoutes from './routes/estructuraRoutes';
import { planRouter } from './routes/planRoutes';
import horariosRoutes from './routes/horariosRoutes';
import asistenciaRoutes from './routes/asistenciaRoutes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/', estructuraRoutes);
app.use('/plan', planRouter);
app.use('/horarios', horariosRoutes);
app.use('/kardex', kardexRoutes);
app.use('/asistencia', asistenciaRoutes);

export default app;
