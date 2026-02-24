import { Router } from "express";
import { receiveInventory, transferInventory } from "../controllers/inventoryController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/receive", asyncHandler(receiveInventory));
router.post("/transfer", asyncHandler(transferInventory));

export default router;
