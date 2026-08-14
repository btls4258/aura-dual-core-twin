import type { Faction, Vec2 } from "./game";

export type AuraTopic =
  | "input.card.scanned" | "input.action.confirm" | "perception.pose"
  | "cmd.robot.move" | "cmd.robot.stop" | "robot.ack"
  | "state.world" | "state.event" | "emergency.stop";

export type AuraEnvelope<T = unknown> = {
  version: "0.1";
  topic: AuraTopic;
  timestamp: number;
  payload: T;
};

export type RobotCommand = {
  commandId: string;
  faction: Faction;
  kind: "move" | "stop" | "revive";
  target?: Vec2;
  path?: Vec2[];
  speedLimit?: number;
};

export const envelope = <T,>(topic: AuraTopic, payload: T): AuraEnvelope<T> => ({ version: "0.1", topic, timestamp: Date.now(), payload });
