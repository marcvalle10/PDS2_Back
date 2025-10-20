import "reflect-metadata";
import app from './main';
import dotenv from 'dotenv'; 
import { AppDataSource } from './config/data-source';

dotenv.config(); 

const PORT = process.env.PORT || 5000;

AppDataSource.initialize().then(() => {
    console.log("Se conecto a la base de datos");
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
});