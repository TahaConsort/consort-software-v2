import express from "express";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createDriverSchema, updateDriverSchema, createVehicleSchema, updateVehicleSchema,
} from "./fleet.validation.js";
import {
  listDrivers, getDriver, createDriver, updateDriver, deactivateDriver,
  listVehicles, getVehicle, createVehicle, updateVehicle, deactivateVehicle,
} from "./fleet.controllers.js";

/**
 * Own-fleet master — drivers and vehicles. Read: `fleet.read`.
 * Writes: `fleet.manage` (ops_manager, ops_exec, transport_manager + Management).
 *
 * Two routers off one module because they are one concern (who and what moves
 * our cargo) mounted at two paths.
 */

export const driverRouter = express.Router();
driverRouter.use(protect);
driverRouter.get("/", requirePermission("fleet.read"), listDrivers);
driverRouter.get("/:id", requirePermission("fleet.read"), getDriver);
driverRouter.post("/", requirePermission("fleet.manage"), validate(createDriverSchema), createDriver);
driverRouter.patch("/:id", requirePermission("fleet.manage"), validate(updateDriverSchema), updateDriver);
driverRouter.post("/:id/deactivate", requirePermission("fleet.manage"), deactivateDriver);

export const vehicleRouter = express.Router();
vehicleRouter.use(protect);
vehicleRouter.get("/", requirePermission("fleet.read"), listVehicles);
vehicleRouter.get("/:id", requirePermission("fleet.read"), getVehicle);
vehicleRouter.post("/", requirePermission("fleet.manage"), validate(createVehicleSchema), createVehicle);
vehicleRouter.patch("/:id", requirePermission("fleet.manage"), validate(updateVehicleSchema), updateVehicle);
vehicleRouter.post("/:id/deactivate", requirePermission("fleet.manage"), deactivateVehicle);
