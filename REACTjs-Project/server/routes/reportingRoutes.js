import { Router } from "express";
import { getMovements, getStockOnHand, listLocations } from "../controllers/inventoryController.js";
import { getPatientDispenseHistory } from "../controllers/dispenseController.js";
import { requireRole, verifyToken } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/stock/on-hand", asyncHandler(getStockOnHand));
router.get("/movements", verifyToken, requireRole("ADMIN", "PHARMACIST", "OPERATOR"), asyncHandler(getMovements));
router.get("/locations", verifyToken, requireRole("ADMIN", "PHARMACIST", "OPERATOR"), asyncHandler(listLocations));
router.get("/patients/:pid/dispense", asyncHandler(getPatientDispenseHistory));

export default router;
