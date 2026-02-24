import { Router } from "express";
import { getMovements, getStockOnHand } from "../controllers/inventoryController.js";
import { getPatientDispenseHistory } from "../controllers/dispenseController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/stock/on-hand", asyncHandler(getStockOnHand));
router.get("/movements", asyncHandler(getMovements));
router.get("/patients/:pid/dispense", asyncHandler(getPatientDispenseHistory));

export default router;
