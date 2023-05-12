import Pokemon, { MoveResult, PokemonMove } from "../pokemon";
import { Type } from "./type";
import * as Utils from "../utils";
import { BattleStat, getBattleStatName } from "./battle-stat";
import { DamagePhase, PokemonHealPhase, ShowAbilityPhase, StatChangePhase } from "../battle-phases";
import { getPokemonMessage } from "../messages";
import { Weather, WeatherType } from "./weather";
import { BattlerTag, BattlerTagType, TrappedTag } from "./battler-tag";
import { StatusEffect, getStatusEffectDescriptor } from "./status-effect";
import { MoveFlags, Moves, RecoilAttr, allMoves } from "./move";
import { ArenaTagType } from "./arena-tag";

export class Ability {
  public id: Abilities;
  public name: string;
  public description: string;
  public generation: integer;
  public attrs: AbAttr[];
  public conditions: AbAttrCondition[];

  constructor(id: Abilities, name: string, description: string, generation: integer) {
    this.id = id;
    this.name = name.toUpperCase();
    this.description = description;
    this.generation = generation;
    this.attrs = [];
    this.conditions = [];
  }

  getAttrs(attrType: { new(...args: any[]): AbAttr }): AbAttr[] {
    return this.attrs.filter(a => a instanceof attrType);
  }

  attr<T extends new (...args: any[]) => AbAttr>(AttrType: T, ...args: ConstructorParameters<T>): Ability {
    const attr = new AttrType(...args);
    this.attrs.push(attr);

    return this;
  }

  hasAttr(attrType: { new(...args: any[]): AbAttr }): boolean {
    return !!this.getAttrs(attrType).length;
  }

  condition(condition: AbAttrCondition): Ability {
    this.conditions.push(condition);

    return this;
  }
}

type AbAttrCondition = (pokemon: Pokemon) => boolean;

export abstract class AbAttr {
  public showAbility: boolean;

  constructor(showAbility?: boolean) {
    this.showAbility = showAbility === undefined || showAbility;
  }
  
  apply(pokemon: Pokemon, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    return false;
  }

  getTriggerMessage(pokemon: Pokemon, ...args: any[]): string {
    return null;
  }

  getCondition(): AbAttrCondition {
    return null;
  }
}

export class BlockRecoilDamageAttr extends AbAttr {
  apply(pokemon: Pokemon, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    cancelled.value = true;

    return true;
  }

  getTriggerMessage(pokemon: Pokemon, ...args: any[]) {
    return getPokemonMessage(pokemon, `'s ${pokemon.getAbility().name}\nprotected it from recoil!`);
  }
}

export class PreDefendAbAttr extends AbAttr {
  applyPreDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    return false;
  }
}

export class BlockItemTheftAbAttr extends AbAttr {
  apply(pokemon: Pokemon, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    cancelled.value = true;;
    
    return true;
  }

  getTriggerMessage(pokemon: Pokemon, ...args: any[]) {
    return getPokemonMessage(pokemon, `'s ${pokemon.getAbility().name}\nprevents item theft!`);
  }
}

export class ReceivedTypeDamageMultiplierAbAttr extends PreDefendAbAttr {
  private moveType: Type;
  private powerMultiplier: number;

  constructor(moveType: Type, powerMultiplier: number) {
    super();

    this.moveType = moveType;
    this.powerMultiplier = powerMultiplier;
  }

  applyPreDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (move.getMove().type === this.moveType) {
      (args[0] as Utils.NumberHolder).value *= this.powerMultiplier;
      return true;
    }

    return false;
  }
}

export class TypeImmunityAbAttr extends PreDefendAbAttr {
  private immuneType: Type;
  private condition: AbAttrCondition;

  constructor(immuneType: Type, condition?: AbAttrCondition) {
    super();

    this.immuneType = immuneType;
    this.condition = condition;
  }

  applyPreDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (move.getMove().type === this.immuneType) {
      (args[0] as Utils.NumberHolder).value = 0;
      return true;
    }

    return false;
  }

  getCondition(): AbAttrCondition {
    return this.condition;
  }
}

export class TypeImmunityHealAbAttr extends TypeImmunityAbAttr {
  constructor(immuneType: Type) {
    super(immuneType);
  }

  applyPreDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const ret = super.applyPreDefend(pokemon, attacker, move, cancelled, args);

    if (ret && pokemon.getHpRatio() < 1) {
      const scene = pokemon.scene;
      scene.unshiftPhase(new PokemonHealPhase(scene, pokemon.isPlayer(), pokemon.getFieldIndex(), Math.max(Math.floor(pokemon.getMaxHp() / 4), 1), getPokemonMessage(pokemon, `'s ${pokemon.getAbility().name}\nrestored its HP a little!`), true));
      return true;
    }
    
    return false;
  }
}

class TypeImmunityStatChangeAbAttr extends TypeImmunityAbAttr {
  private stat: BattleStat;
  private levels: integer;

  constructor(immuneType: Type, stat: BattleStat, levels: integer, condition?: AbAttrCondition) {
    super(immuneType, condition);

    this.stat = stat;
    this.levels = levels;
  }

  applyPreDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const ret = super.applyPreDefend(pokemon, attacker, move, cancelled, args);

    if (ret) {
      cancelled.value = true;
      pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.isPlayer(), pokemon.getFieldIndex(), true, [ this.stat ], this.levels));
    }
    
    return ret;
  }
}

class TypeImmunityAddBattlerTagAbAttr extends TypeImmunityAbAttr {
  private tagType: BattlerTagType;
  private turnCount: integer;

  constructor(immuneType: Type, tagType: BattlerTagType, turnCount: integer, condition?: AbAttrCondition) {
    super(immuneType, condition);

    this.tagType = tagType;
    this.turnCount = turnCount;
  }

  applyPreDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const ret = super.applyPreDefend(pokemon, attacker, move, cancelled, args);

    if (ret) {
      cancelled.value = true;
      pokemon.addTag(this.tagType, this.turnCount, undefined, pokemon.id);
    }
    
    return ret;
  }
}

export class NonSuperEffectiveImmunityAbAttr extends TypeImmunityAbAttr {
  constructor(condition?: AbAttrCondition) {
    super(null, condition);
  }

  applyPreDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (pokemon.getAttackMoveEffectiveness(move.getMove().type) < 2) {
      cancelled.value = true;
      (args[0] as Utils.NumberHolder).value = 0;
      return true;
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, ...args: any[]): string {
    return getPokemonMessage(pokemon, ` avoided damage\nwith ${pokemon.getAbility().name}!`);
  }
}

export class PostDefendAbAttr extends AbAttr {
  applyPostDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, moveResult: MoveResult, args: any[]): boolean {
    return false;
  }
}

export class PostDefendTypeChangeAbAttr extends PostDefendAbAttr {
  applyPostDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, moveResult: MoveResult, args: any[]): boolean {
    if (moveResult < MoveResult.NO_EFFECT) {
      const type = move.getMove().type;
      const pokemonTypes = pokemon.getTypes();
      if (pokemonTypes.length !== 1 || pokemonTypes[0] !== type) {
        pokemon.summonData.types = [ type ];
        return true;
      }
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${pokemon.getAbility().name}\nmade it the ${Type[pokemon.getTypes()[0]]} type!`);
  }
}

export class PostDefendContactApplyStatusEffectAbAttr extends PostDefendAbAttr {
  private chance: integer;
  private effects: StatusEffect[];

  constructor(chance: integer, ...effects: StatusEffect[]) {
    super();

    this.chance = chance;
    this.effects = effects;
  }

  applyPostDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, moveResult: MoveResult, args: any[]): boolean {
    if (move.getMove().hasFlag(MoveFlags.MAKES_CONTACT) && Utils.randInt(100) < this.chance) {
      const effect = this.effects.length === 1 ? this.effects[0] : this.effects[Utils.randInt(this.effects.length)];
      return attacker.trySetStatus(effect);
    }

    return false;
  }
}

export class PostDefendContactApplyTagChanceAbAttr extends PostDefendAbAttr {
  private chance: integer;
  private tagType: BattlerTagType;
  private turnCount: integer;

  constructor(chance: integer, tagType: BattlerTagType, turnCount?: integer) {
    super();

    this.tagType = tagType;
    this.chance = chance;
    this.turnCount = turnCount;
  }

  applyPostDefend(pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, moveResult: MoveResult, args: any[]): boolean {
    if (move.getMove().hasFlag(MoveFlags.MAKES_CONTACT) && Utils.randInt(100) < this.chance)
      return attacker.addTag(this.tagType, this.turnCount, move.moveId, pokemon.id);

    return false;
  }
}

export class PreAttackAbAttr extends AbAttr {
  applyPreAttack(pokemon: Pokemon, defender: Pokemon, move: PokemonMove, args: any[]): boolean {
    return false;
  }
}

export class VariableMovePowerAbAttr extends PreAttackAbAttr {
  applyPreAttack(pokemon: Pokemon, defender: Pokemon, move: PokemonMove, args: any[]): boolean {
    //const power = args[0] as Utils.NumberHolder;
    return false; 
  }
}

export class LowHpMoveTypePowerBoostAbAttr extends VariableMovePowerAbAttr {
  private boostedType: Type;

  constructor(boostedType: Type) {
    super();

    this.boostedType = boostedType;
  }

  applyPreAttack(pokemon: Pokemon, defender: Pokemon, move: PokemonMove, args: any[]): boolean {
    if (move.getMove().type === this.boostedType) {
      (args[0] as Utils.NumberHolder).value *= 1.5;

      return true;
    }

    return false;
  }

  getCondition(): AbAttrCondition {
    return (pokemon) => pokemon.getHpRatio() <= 0.33;
  }
}

export class RecoilMovePowerBoostAbAttr extends VariableMovePowerAbAttr {
  applyPreAttack(pokemon: Pokemon, defender: Pokemon, move: PokemonMove, args: any[]): boolean {
    if (move.getMove().getAttrs(RecoilAttr).length && move.moveId !== Moves.STRUGGLE) {
      (args[0] as Utils.NumberHolder).value *= 1.2;

      return true;
    }

    return false;
  }
}

export class BattleStatMultiplierAbAttr extends AbAttr {
  private battleStat: BattleStat;
  private multiplier: number;

  constructor(battleStat: BattleStat, multiplier: number) {
    super();

    this.battleStat = battleStat;
    this.multiplier = multiplier;
  }

  applyBattleStat(pokemon: Pokemon, battleStat: BattleStat, statValue: Utils.NumberHolder, args: any[]) {
    if (battleStat === this.battleStat) {
      statValue.value *= this.multiplier;
      return true;
    }

    return false;
  }
}

export class PostSummonAbAttr extends AbAttr {
  applyPostSummon(pokemon: Pokemon, args: any[]) {
    return false;
  }
}

export class PostSummonAddBattlerTagAbAttr extends PostSummonAbAttr {
  private tagType: BattlerTagType;
  private turnCount: integer;

  constructor(tagType: BattlerTagType, turnCount: integer) {
    super(false);

    this.tagType = tagType;
    this.turnCount = turnCount;
  }

  applyPostSummon(pokemon: Pokemon, args: any[]): boolean {
    return pokemon.addTag(this.tagType, this.turnCount);
  }
}

export class PostSummonStatChangeAbAttr extends PostSummonAbAttr {
  private stats: BattleStat[];
  private levels: integer;
  private selfTarget: boolean;

  constructor(stats: BattleStat | BattleStat[], levels: integer, selfTarget?: boolean) {
    super();

    this.stats = typeof(stats) === 'number'
      ? [ stats as BattleStat ]
      : stats as BattleStat[];
    this.levels = levels;
    this.selfTarget = !!selfTarget;
  }

  applyPostSummon(pokemon: Pokemon, args: any[]): boolean {
    const statChangePhase = new StatChangePhase(pokemon.scene, pokemon.isPlayer() === this.selfTarget, pokemon.getFieldIndex(), this.selfTarget, this.stats, this.levels);

    if (!this.selfTarget && !pokemon.getOpponent(0)?.summonData)
      pokemon.scene.pushPhase(statChangePhase); // TODO: This causes the ability bar to be shown at the wrong time
    else
      pokemon.scene.unshiftPhase(statChangePhase);

   
    return true;
  }
}

export class PostSummonWeatherChangeAbAttr extends PostSummonAbAttr {
  private weatherType: WeatherType;

  constructor(weatherType: WeatherType) {
    super();

    this.weatherType = weatherType;
  }

  applyPostSummon(pokemon: Pokemon, args: any[]): boolean {
    if (!pokemon.scene.arena.weather?.isImmutable())
      return pokemon.scene.arena.trySetWeather(this.weatherType, false);

    return false;
  }
}

export class PreStatChangeAbAttr extends AbAttr {
  applyPreStatChange(pokemon: Pokemon, stat: BattleStat, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    return false;
  }
}

export class ProtectStatAbAttr extends PreStatChangeAbAttr {
  private protectedStat: BattleStat;

  constructor(protectedStat?: BattleStat) {
    super();

    this.protectedStat = protectedStat;
  }

  applyPreStatChange(pokemon: Pokemon, stat: BattleStat, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (this.protectedStat === undefined || stat === this.protectedStat) {
      cancelled.value = true;
      return true;
    }
    
    return false;
  }

  getTriggerMessage(pokemon: Pokemon, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${pokemon.getAbility().name}\nprevents lowering its ${this.protectedStat !== undefined ? getBattleStatName(this.protectedStat) : 'stats'}!`);
  }
}

export class PreSetStatusAbAttr extends AbAttr {
  applyPreSetStatus(pokemon: Pokemon, effect: StatusEffect, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    return false;
  }
}

export class StatusEffectImmunityAbAttr extends PreSetStatusAbAttr {
  private immuneEffects: StatusEffect[];

  constructor(...immuneEffects: StatusEffect[]) {
    super();

    this.immuneEffects = immuneEffects;
  }

  applyPreSetStatus(pokemon: Pokemon, effect: StatusEffect, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (!this.immuneEffects.length || this.immuneEffects.indexOf(effect) > -1) {
      cancelled.value = true;
      return true;
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${pokemon.getAbility().name}\nprevents ${this.immuneEffects.length ? getStatusEffectDescriptor(args[0] as StatusEffect) : 'status problems'}!`);
  }
}

export class PreApplyBattlerTagAbAttr extends AbAttr {
  applyPreApplyBattlerTag(pokemon: Pokemon, tag: BattlerTag, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    return false;
  }
}

export class BattlerTagImmunityAbAttr extends PreApplyBattlerTagAbAttr {
  private immuneTagType: BattlerTagType;

  constructor(immuneTagType: BattlerTagType) {
    super();

    this.immuneTagType = immuneTagType;
  }

  applyPreApplyBattlerTag(pokemon: Pokemon, tag: BattlerTag, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (tag.tagType === this.immuneTagType) {
      cancelled.value = true;
      return true;
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${pokemon.getAbility().name}\nprevents ${(args[0] as BattlerTag).getDescriptor()}!`);
  }
}

export class BlockCritAbAttr extends AbAttr { }

export class PreWeatherEffectAbAttr extends AbAttr {
  applyPreWeatherEffect(pokemon: Pokemon, weather: Weather, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    return false;
  }
}

export class PreWeatherDamageAbAttr extends PreWeatherEffectAbAttr { }

export class BlockWeatherDamageAttr extends PreWeatherDamageAbAttr {
  private weatherTypes: WeatherType[];

  constructor(...weatherTypes: WeatherType[]) {
    super();

    this.weatherTypes = weatherTypes;
  }

  applyPreWeatherEffect(pokemon: Pokemon, weather: Weather, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (!this.weatherTypes.length || this.weatherTypes.indexOf(weather?.weatherType) > -1)
      cancelled.value = true;

    return true;
  }
}

export class SuppressWeatherEffectAbAttr extends PreWeatherEffectAbAttr {
  public affectsImmutable: boolean;

  constructor(affectsImmutable?: boolean) {
    super();

    this.affectsImmutable = affectsImmutable;
  }

  applyPreWeatherEffect(pokemon: Pokemon, weather: Weather, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (this.affectsImmutable || weather.isImmutable()) {
      cancelled.value = true;
      return true;
    }

    return false;
  }
}

export class PostTurnAbAttr extends AbAttr {
  applyPostTurn(pokemon: Pokemon, args: any[]) {
    return false;
  }
}

export class PostTurnSpeedBoostAbAttr extends PostTurnAbAttr {
  applyPostTurn(pokemon: Pokemon, args: any[]): boolean {
    pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.isPlayer(), pokemon.getFieldIndex(), true, [ BattleStat.SPD ], 1));
    return true;
  }
}

function getWeatherCondition(...weatherTypes: WeatherType[]): AbAttrCondition {
  return (pokemon: Pokemon) => {
    if (pokemon.scene.arena.weather?.isEffectSuppressed(pokemon.scene))
      return false;
    const weatherType = pokemon.scene.arena.weather?.weatherType;
    return weatherType && weatherTypes.indexOf(weatherType) > -1;
  };
}

export class PostTurnHealAbAttr extends PostTurnAbAttr {
  applyPostTurn(pokemon: Pokemon, args: any[]): boolean {
    if (pokemon.getHpRatio() < 1) {
      const scene = pokemon.scene;
      scene.unshiftPhase(new PokemonHealPhase(scene, pokemon.isPlayer(), pokemon.getFieldIndex(),
        Math.max(Math.floor(pokemon.getMaxHp() / 16), 1), getPokemonMessage(pokemon, `'s ${pokemon.getAbility().name}\nrestored its HP a little!`), true));
      return true;
    }

    return false;
  }
}

export class PostWeatherLapseAbAttr extends AbAttr {
  protected weatherTypes: WeatherType[];

  constructor(...weatherTypes: WeatherType[]) {
    super();

    this.weatherTypes = weatherTypes;
  }

  applyPostWeatherLapse(pokemon: Pokemon, weather: Weather, args: any[]): boolean {
    return false;
  }

  getCondition(): AbAttrCondition {
    return getWeatherCondition(...this.weatherTypes);
  }
}

export class PostWeatherLapseHealAbAttr extends PostWeatherLapseAbAttr {
  private healFactor: integer;

  constructor(healFactor: integer, ...weatherTypes: WeatherType[]) {
    super(...weatherTypes);
    
    this.healFactor = healFactor;
  }

  applyPostWeatherLapse(pokemon: Pokemon, weather: Weather, args: any[]): boolean {
    if (pokemon.getHpRatio() < 1) {
      const scene = pokemon.scene;
      scene.unshiftPhase(new PokemonHealPhase(scene, pokemon.isPlayer(), pokemon.getFieldIndex(), Math.max(Math.floor(pokemon.getMaxHp() / (16 / this.healFactor)), 1), getPokemonMessage(pokemon, `'s ${pokemon.getAbility().name}\nrestored its HP a little!`), true));
      return true;
    }

    return false;
  }
}

export class PostWeatherLapseDamageAbAttr extends PostWeatherLapseAbAttr {
  private damageFactor: integer;

  constructor(damageFactor: integer, ...weatherTypes: WeatherType[]) {
    super(...weatherTypes);
    
    this.damageFactor = damageFactor;
  }

  applyPostWeatherLapse(pokemon: Pokemon, weather: Weather, args: any[]): boolean {
    if (pokemon.getHpRatio() < 1) {
      const scene = pokemon.scene;
      scene.queueMessage(getPokemonMessage(pokemon, ` is hurt\nby its ${pokemon.getAbility()}!`));
      scene.unshiftPhase(new DamagePhase(pokemon.scene, pokemon.isPlayer(), pokemon.getFieldIndex(), MoveResult.OTHER));
      pokemon.damage(Math.ceil(pokemon.getMaxHp() * (16 / this.damageFactor)));
      return true;
    }

    return false;
  }
}

export class CheckTrappedAbAttr extends AbAttr {
  applyCheckTrapped(pokemon: Pokemon, trapped: Utils.BooleanHolder, args: any[]): boolean {
    return false;
  }
}

export class ArenaTrapAbAttr extends CheckTrappedAbAttr {
  applyCheckTrapped(pokemon: Pokemon, trapped: Utils.BooleanHolder, args: any[]): boolean {
    trapped.value = true;
    return true;
  }

  getTriggerMessage(pokemon: Pokemon, ...args: any[]): string {
    return getPokemonMessage(pokemon, `\'s ${pokemon.getAbility().name}\nprevents switching!`);
  }
}

export function applyAbAttrs(attrType: { new(...args: any[]): AbAttr }, pokemon: Pokemon, cancelled: Utils.BooleanHolder, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as AbAttr[];
  console.log(attrs, ability);
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.apply(pokemon, cancelled, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPreDefendAbAttrs(attrType: { new(...args: any[]): PreDefendAbAttr },
  pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as PreDefendAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPreDefend(pokemon, attacker, move, cancelled, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon, attacker, move);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPostDefendAbAttrs(attrType: { new(...args: any[]): PostDefendAbAttr },
  pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, moveResult: MoveResult, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as PostDefendAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPostDefend(pokemon, attacker, move, moveResult, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon, attacker, move);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyBattleStatMultiplierAbAttrs(attrType: { new(...args: any[]): BattleStatMultiplierAbAttr },
  pokemon: Pokemon, battleStat: BattleStat, statValue: Utils.NumberHolder, ...args: any[]) {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as BattleStatMultiplierAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyBattleStat(pokemon, battleStat, statValue, args)) {
      const message = attr.getTriggerMessage(pokemon);
      if (message) {
        if (attr.showAbility)
          queueShowAbility(pokemon);
        pokemon.scene.queueMessage(message);
      }
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPreAttackAbAttrs(attrType: { new(...args: any[]): PreAttackAbAttr },
  pokemon: Pokemon, defender: Pokemon, move: PokemonMove, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as PreAttackAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPreAttack(pokemon, defender, move, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon, defender, move);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPostSummonAbAttrs(attrType: { new(...args: any[]): PostSummonAbAttr },
  pokemon: Pokemon, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as PostSummonAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPostSummon(pokemon, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPreStatChangeAbAttrs(attrType: { new(...args: any[]): PreStatChangeAbAttr },
  pokemon: Pokemon, stat: BattleStat, cancelled: Utils.BooleanHolder, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as PreStatChangeAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPreStatChange(pokemon, stat, cancelled, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon, stat);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPreSetStatusAbAttrs(attrType: { new(...args: any[]): PreSetStatusAbAttr },
  pokemon: Pokemon, effect: StatusEffect, cancelled: Utils.BooleanHolder, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as PreSetStatusAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPreSetStatus(pokemon, effect, cancelled, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon, effect);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPreApplyBattlerTagAbAttrs(attrType: { new(...args: any[]): PreApplyBattlerTagAbAttr },
  pokemon: Pokemon, tag: BattlerTag, cancelled: Utils.BooleanHolder, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as PreApplyBattlerTagAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPreApplyBattlerTag(pokemon, tag, cancelled, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon, tag);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPreWeatherEffectAbAttrs(attrType: { new(...args: any[]): PreWeatherEffectAbAttr },
  pokemon: Pokemon, weather: Weather, cancelled: Utils.BooleanHolder, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as PreWeatherEffectAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPreWeatherEffect(pokemon, weather, cancelled, args)) {
      pokemon.scene.abilityBar.showAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon, weather);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPostTurnAbAttrs(attrType: { new(...args: any[]): PostTurnAbAttr },
  pokemon: Pokemon, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();

  const attrs = ability.getAttrs(attrType) as PostTurnAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPostTurn(pokemon, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyPostWeatherLapseAbAttrs(attrType: { new(...args: any[]): PostWeatherLapseAbAttr },
  pokemon: Pokemon, weather: Weather, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  if (weather.isEffectSuppressed(pokemon.scene))
    return;

  const ability = pokemon.getAbility();

  const attrs = ability.getAttrs(attrType) as PostWeatherLapseAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyPostWeatherLapse(pokemon, weather, args)) {
      if (attr.showAbility)
        queueShowAbility(pokemon);
      const message = attr.getTriggerMessage(pokemon, weather);
      if (message)
        pokemon.scene.queueMessage(message);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

export function applyCheckTrappedAbAttrs(attrType: { new(...args: any[]): CheckTrappedAbAttr },
  pokemon: Pokemon, trapped: Utils.BooleanHolder, ...args: any[]): void {
  if (!pokemon.canApplyAbility())
    return;

  const ability = pokemon.getAbility();
  const attrs = ability.getAttrs(attrType) as CheckTrappedAbAttr[];
  for (let attr of attrs) {
    if (!canApplyAttr(pokemon, attr))
      continue;
    pokemon.scene.setPhaseQueueSplice();
    if (attr.applyCheckTrapped(pokemon, trapped, args)) {
      // Don't show ability bar because this call is asynchronous
      const message = attr.getTriggerMessage(pokemon);
      if (message)
        pokemon.scene.ui.showText(message, null, () => pokemon.scene.ui.showText(null, 0), null, true);
    }
  }

  pokemon.scene.clearPhaseQueueSplice();
}

function canApplyAttr(pokemon: Pokemon, attr: AbAttr): boolean {
  const condition = attr.getCondition();
  return !condition || condition(pokemon);
}

function queueShowAbility(pokemon: Pokemon): void {
  pokemon.scene.unshiftPhase(new ShowAbilityPhase(pokemon.scene, pokemon.isPlayer(), pokemon.getFieldIndex()));
  pokemon.scene.clearPhaseQueueSplice();
}

export enum Abilities {
  NONE,
  AIR_LOCK = 1,
  ARENA_TRAP,
  BATTLE_ARMOR,
  BLAZE,
  CHLOROPHYLL,
  CLEAR_BODY,
  CLOUD_NINE,
  COLOR_CHANGE,
  COMPOUND_EYES,
  CUTE_CHARM,
  DAMP,
  DRIZZLE,
  DROUGHT,
  EARLY_BIRD,
  EFFECT_SPORE,
  FLAME_BODY,
  FLASH_FIRE,
  FORECAST,
  GUTS,
  HUGE_POWER,
  HUSTLE,
  HYPER_CUTTER,
  ILLUMINATE,
  IMMUNITY,
  INNER_FOCUS,
  INSOMNIA,
  INTIMIDATE,
  KEEN_EYE,
  LEVITATE,
  LIGHTNING_ROD,
  LIMBER,
  LIQUID_OOZE,
  MAGMA_ARMOR,
  MAGNET_PULL,
  MARVEL_SCALE,
  MINUS,
  NATURAL_CURE,
  OBLIVIOUS,
  OVERGROW,
  OWN_TEMPO,
  PICKUP,
  PLUS,
  POISON_POINT,
  PRESSURE,
  PURE_POWER,
  RAIN_DISH,
  ROCK_HEAD,
  ROUGH_SKIN,
  RUN_AWAY,
  SAND_STREAM,
  SAND_VEIL,
  SERENE_GRACE,
  SHADOW_TAG,
  SHED_SKIN,
  SHELL_ARMOR,
  SHIELD_DUST,
  SOUNDPROOF,
  SPEED_BOOST,
  STATIC,
  STENCH,
  STICKY_HOLD,
  STURDY,
  SUCTION_CUPS,
  SWARM,
  SWIFT_SWIM,
  SYNCHRONIZE,
  THICK_FAT,
  TORRENT,
  TRACE,
  TRUANT,
  VITAL_SPIRIT,
  VOLT_ABSORB,
  WATER_ABSORB,
  WATER_VEIL,
  WHITE_SMOKE,
  WONDER_GUARD,
  ADAPTABILITY,
  AFTERMATH,
  ANGER_POINT,
  ANTICIPATION,
  BAD_DREAMS,
  DOWNLOAD,
  DRY_SKIN,
  FILTER,
  FLOWER_GIFT,
  FOREWARN,
  FRISK,
  GLUTTONY,
  HEATPROOF,
  HONEY_GATHER,
  HYDRATION,
  ICE_BODY,
  IRON_FIST,
  KLUTZ,
  LEAF_GUARD,
  MAGIC_GUARD,
  MOLD_BREAKER,
  MOTOR_DRIVE,
  MULTITYPE,
  NO_GUARD,
  NORMALIZE,
  POISON_HEAL,
  QUICK_FEET,
  RECKLESS,
  RIVALRY,
  SCRAPPY,
  SIMPLE,
  SKILL_LINK,
  SLOW_START,
  SNIPER,
  SNOW_CLOAK,
  SNOW_WARNING,
  SOLAR_POWER,
  SOLID_ROCK,
  STALL,
  STEADFAST,
  STORM_DRAIN,
  SUPER_LUCK,
  TANGLED_FEET,
  TECHNICIAN,
  TINTED_LENS,
  UNAWARE,
  UNBURDEN,
  ANALYTIC,
  BIG_PECKS,
  CONTRARY,
  CURSED_BODY,
  DEFEATIST,
  DEFIANT,
  FLARE_BOOST,
  FRIEND_GUARD,
  HARVEST,
  HEALER,
  HEAVY_METAL,
  ILLUSION,
  IMPOSTER,
  INFILTRATOR,
  IRON_BARBS,
  JUSTIFIED,
  LIGHT_METAL,
  MAGIC_BOUNCE,
  MOODY,
  MOXIE,
  MULTISCALE,
  MUMMY,
  OVERCOAT,
  PICKPOCKET,
  POISON_TOUCH,
  PRANKSTER,
  RATTLED,
  REGENERATOR,
  SAND_FORCE,
  SAND_RUSH,
  SAP_SIPPER,
  SHEER_FORCE,
  TELEPATHY,
  TERAVOLT,
  TOXIC_BOOST,
  TURBOBLAZE,
  UNNERVE,
  VICTORY_STAR,
  WEAK_ARMOR,
  WONDER_SKIN,
  ZEN_MODE,
  COMPETITIVE,
  DARK_AURA,
  FAIRY_AURA,
  PROTEAN,
  SLUSH_RUSH,
  NEUTRALIZING_GAS
}

export const abilities = [ new Ability(Abilities.NONE, "-", "", 3) ];

export function initAbilities() {
  abilities.push(
    new Ability(Abilities.AIR_LOCK, "Air Lock", "Eliminates the effects of all weather.", 3)
      .attr(SuppressWeatherEffectAbAttr, true),
    new Ability(Abilities.ARENA_TRAP, "Arena Trap", "Prevents the foe from fleeing.", 3)
      .attr(ArenaTrapAbAttr),
    new Ability(Abilities.BATTLE_ARMOR, "Battle Armor", "The POKéMON is protected against critical hits.", 3)
      .attr(BlockCritAbAttr),
    new Ability(Abilities.BLAZE, "Blaze", "Powers up FIRE-type moves in a pinch.", 3)
      .attr(LowHpMoveTypePowerBoostAbAttr, Type.FIRE),
    new Ability(Abilities.CHLOROPHYLL, "Chlorophyll", "Boosts the POKéMON's SPEED in sunshine.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.SPD, 2)
      .condition(getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN)), // TODO: Show ability bar on weather change and summon
    new Ability(Abilities.CLEAR_BODY, "Clear Body", "Prevents other POKéMON from lowering its stats.", 3)
      .attr(ProtectStatAbAttr),
    new Ability(Abilities.CLOUD_NINE, "Cloud Nine", "Eliminates the effects of non-severe weather.", 3)
      .attr(SuppressWeatherEffectAbAttr),
    new Ability(Abilities.COLOR_CHANGE, "Color Change", "Changes the POKéMON's type to the foe's move.", 3)
      .attr(PostDefendTypeChangeAbAttr),
    new Ability(Abilities.COMPOUND_EYES, "Compound Eyes", "The POKéMON's accuracy is boosted.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.ACC, 1.3),
    new Ability(Abilities.CUTE_CHARM, "Cute Charm", "Contact with the POKéMON may cause infatuation.", 3)
      .attr(PostDefendContactApplyTagChanceAbAttr, 30, BattlerTagType.INFATUATED),
    new Ability(Abilities.DAMP, "Damp (N)", "Prevents the use of self-destructing moves.", 3),
    new Ability(Abilities.DRIZZLE, "Drizzle", "The POKéMON makes it rain when it enters a battle.", 3)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.RAIN),
    new Ability(Abilities.DROUGHT, "Drought", "Turns the sunlight harsh when the POKéMON enters a battle.", 3)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SUNNY),
    new Ability(Abilities.EARLY_BIRD, "Early Bird (N)", "The POKéMON awakens quickly from sleep.", 3),
    new Ability(Abilities.EFFECT_SPORE, "Effect Spore", "Contact may poison or cause paralysis or sleep.", 3)
      .attr(PostDefendContactApplyStatusEffectAbAttr, 10, StatusEffect.POISON, StatusEffect.PARALYSIS, StatusEffect.SLEEP),
    new Ability(Abilities.FLAME_BODY, "Flame Body", "Contact with the POKéMON may burn the attacker.", 3)
      .attr(PostDefendContactApplyStatusEffectAbAttr, 30, StatusEffect.BURN),
    new Ability(Abilities.FLASH_FIRE, "Flash Fire", "It powers up FIRE-type moves if it's hit by one.", 3)
      .attr(TypeImmunityAddBattlerTagAbAttr, Type.FIRE, 1, BattlerTagType.FIRE_BOOST, (pokemon: Pokemon) => !pokemon.status || pokemon.status.effect !== StatusEffect.FREEZE),
    new Ability(Abilities.FORECAST, "Forecast (N)", "Castform transforms with the weather.", 3),
    new Ability(Abilities.GUTS, "Guts (N)", "Boosts ATTACK if there is a status problem.", 3),
    new Ability(Abilities.HUGE_POWER, "Huge Power", "Raises the POKéMON's ATTACK stat.", 3)
      .attr(PostSummonStatChangeAbAttr, BattleStat.ATK, 1, true),
    new Ability(Abilities.HUSTLE, "Hustle (N)", "Boosts the ATTACK stat, but lowers accuracy.", 3),
    new Ability(Abilities.HYPER_CUTTER, "Hyper Cutter", "Prevents other POKéMON from lowering ATTACK stat.", 3)
      .attr(ProtectStatAbAttr, BattleStat.ATK),
    new Ability(Abilities.ILLUMINATE, "Illuminate (N)", "Raises the likelihood of meeting wild POKéMON.", 3),
    new Ability(Abilities.IMMUNITY, "Immunity", "Prevents the POKéMON from getting poisoned.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.POISON),
    new Ability(Abilities.INNER_FOCUS, "Inner Focus", "The POKéMON is protected from flinching.", 3)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.FLINCHED),
    new Ability(Abilities.INSOMNIA, "Insomnia", "Prevents the POKéMON from falling asleep.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.SLEEP)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.DROWSY),
    new Ability(Abilities.INTIMIDATE, "Intimidate", "Lowers the foe's ATTACK stat.", 3)
      .attr(PostSummonStatChangeAbAttr, BattleStat.ATK, -1),
    new Ability(Abilities.KEEN_EYE, "Keen Eye", "Prevents other POKéMON from lowering accuracy.", 3)
      .attr(ProtectStatAbAttr, BattleStat.ACC),
    new Ability(Abilities.LEVITATE, "Levitate", "Gives immunity to GROUND-type moves.", 3)
      .attr(TypeImmunityAbAttr, Type.GROUND, (pokemon: Pokemon) => !pokemon.getTag(BattlerTagType.IGNORE_FLYING) && !pokemon.scene.arena.getTag(ArenaTagType.GRAVITY)),
    new Ability(Abilities.LIGHTNING_ROD, "Lightning Rod", "Draws in all ELECTRIC-type moves to up SP. ATK.", 3)
      .attr(TypeImmunityStatChangeAbAttr, Type.ELECTRIC, BattleStat.SPATK, 1),
    new Ability(Abilities.LIMBER, "Limber", "The POKéMON is protected from paralysis.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.PARALYSIS),
    new Ability(Abilities.LIQUID_OOZE, "Liquid Ooze (N)", "Damages attackers using any draining move.", 3),
    new Ability(Abilities.MAGMA_ARMOR, "Magma Armor", "Prevents the POKéMON from becoming frozen.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.FREEZE),
    new Ability(Abilities.MAGNET_PULL, "Magnet Pull", "Prevents STEEL-type POKéMON from escaping.", 3)
      /*.attr(ArenaTrapAbAttr)
      .condition((pokemon: Pokemon) => pokemon.getOpponent()?.isOfType(Type.STEEL))*/, // TODO: Rework
    new Ability(Abilities.MARVEL_SCALE, "Marvel Scale (N)", "Ups DEFENSE if there is a status problem.", 3),
    new Ability(Abilities.MINUS, "Minus (N)", "Ups SP. ATK if another POKéMON has PLUS or MINUS.", 3),
    new Ability(Abilities.NATURAL_CURE, "Natural Cure (N)", "All status problems heal when it switches out.", 3),
    new Ability(Abilities.OBLIVIOUS, "Oblivious", "Prevents it from becoming infatuated.", 3)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.INFATUATED),
    new Ability(Abilities.OVERGROW, "Overgrow", "Powers up GRASS-type moves in a pinch.", 3)
      .attr(LowHpMoveTypePowerBoostAbAttr, Type.GRASS),
    new Ability(Abilities.OWN_TEMPO, "Own Tempo", "Prevents the POKéMON from becoming confused.", 3)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.CONFUSED),
    new Ability(Abilities.PICKUP, "Pickup (N)", "The POKéMON may pick up items.", 3),
    new Ability(Abilities.PLUS, "Plus (N)", "Ups SP. ATK if another POKéMON has PLUS or MINUS.", 3),
    new Ability(Abilities.POISON_POINT, "Poison Point", "Contact with the POKéMON may poison the attacker.", 3)
      .attr(PostDefendContactApplyStatusEffectAbAttr, StatusEffect.POISON),
    new Ability(Abilities.PRESSURE, "Pressure (N)", "The POKéMON raises the foe's PP usage.", 3),
    new Ability(Abilities.PURE_POWER, "Pure Power", "Raises the POKéMON's ATTACK stat.", 3)
      .attr(PostSummonStatChangeAbAttr, BattleStat.ATK, 1, true),
    new Ability(Abilities.RAIN_DISH, "Rain Dish", "The POKéMON gradually regains HP in rain.", 3)
      .attr(PostWeatherLapseHealAbAttr, 1, WeatherType.RAIN, WeatherType.HEAVY_RAIN),
    new Ability(Abilities.ROCK_HEAD, "Rock Head", "Protects the POKéMON from recoil damage.", 3)
      .attr(BlockRecoilDamageAttr),
    new Ability(Abilities.ROUGH_SKIN, "Rough Skin (N)", "Inflicts damage to the attacker on contact.", 3),
    new Ability(Abilities.RUN_AWAY, "Run Away (N)", "Enables a sure getaway from wild POKéMON.", 3),
    new Ability(Abilities.SAND_STREAM, "Sand Stream", "The POKéMON summons a sandstorm in battle.", 3)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SANDSTORM),
    new Ability(Abilities.SAND_VEIL, "Sand Veil", "Boosts the POKéMON's evasion in a sandstorm.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.EVA, 1.2)
      .attr(BlockWeatherDamageAttr, WeatherType.SANDSTORM)
      .condition(getWeatherCondition(WeatherType.SANDSTORM)),
    new Ability(Abilities.SERENE_GRACE, "Serene Grace (N)", "Boosts the likelihood of added effects appearing.", 3),
    new Ability(Abilities.SHADOW_TAG, "Shadow Tag", "Prevents the foe from escaping.", 3)
      .attr(ArenaTrapAbAttr),
    new Ability(Abilities.SHED_SKIN, "Shed Skin (N)", "The POKéMON may heal its own status problems.", 3),
    new Ability(Abilities.SHELL_ARMOR, "Shell Armor", "The POKéMON is protected against critical hits.", 3)
      .attr(BlockCritAbAttr),
    new Ability(Abilities.SHIELD_DUST, "Shield Dust (N)", "Blocks the added effects of attacks taken.", 3),
    new Ability(Abilities.SOUNDPROOF, "Soundproof (N)", "Gives immunity to sound-based moves.", 3),
    new Ability(Abilities.SPEED_BOOST, "Speed Boost", "Its SPEED stat is gradually boosted.", 3)
      .attr(PostTurnSpeedBoostAbAttr),
    new Ability(Abilities.STATIC, "Static", "Contact with the POKéMON may cause paralysis.", 3)
      .attr(PostDefendContactApplyStatusEffectAbAttr, StatusEffect.PARALYSIS),
    new Ability(Abilities.STENCH, "Stench (N)", "The stench may cause the target to flinch.", 3),
    new Ability(Abilities.STICKY_HOLD, "Sticky Hold", "Protects the POKéMON from item theft.", 3)
      .attr(BlockItemTheftAbAttr),
    new Ability(Abilities.STURDY, "Sturdy (N)", "It cannot be knocked out with one hit.", 3),
    new Ability(Abilities.SUCTION_CUPS, "Suction Cups (N)", "Negates all moves that force switching out.", 3),
    new Ability(Abilities.SWARM, "Swarm", "Powers up BUG-type moves in a pinch.", 3)
      .attr(LowHpMoveTypePowerBoostAbAttr, Type.BUG),
    new Ability(Abilities.SWIFT_SWIM, "Swift Swim", "Boosts the POKéMON's SPEED in rain.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.SPD, 2)
      .condition(getWeatherCondition(WeatherType.RAIN, WeatherType.HEAVY_RAIN)), // TODO: Show ability bar on weather change and summon
    new Ability(Abilities.SYNCHRONIZE, "Synchronize (N)", "Passes a burn, poison, or paralysis to the foe.", 3),
    new Ability(Abilities.THICK_FAT, "Thick Fat", "Ups resistance to Fire- and ICE-type moves.", 3)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.FIRE, 0.5)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.ICE, 0.5),
    new Ability(Abilities.TORRENT, "Torrent", "Powers up WATER-type moves in a pinch.", 3)
      .attr(LowHpMoveTypePowerBoostAbAttr, Type.WATER),
    new Ability(Abilities.TRACE, "Trace (N)", "The POKéMON copies a foe's Ability.", 3),
    new Ability(Abilities.TRUANT, "Truant", "POKéMON can't attack on consecutive turns.", 3)
      .attr(PostSummonAddBattlerTagAbAttr, BattlerTagType.TRUANT, 1),
    new Ability(Abilities.VITAL_SPIRIT, "Vital Spirit", "Prevents the POKéMON from falling asleep.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.SLEEP)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.DROWSY),
    new Ability(Abilities.VOLT_ABSORB, "Volt Absorb", "Restores HP if hit by an ELECTRIC-type move.", 3)
      .attr(TypeImmunityHealAbAttr, Type.ELECTRIC),
    new Ability(Abilities.WATER_ABSORB, "Water Absorb", "Restores HP if hit by a WATER-type move.", 3)
      .attr(TypeImmunityHealAbAttr, Type.WATER),
    new Ability(Abilities.WATER_VEIL, "Water Veil", "Prevents the POKéMON from getting a burn.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.BURN),
    new Ability(Abilities.WHITE_SMOKE, "White Smoke", "Prevents other POKéMON from lowering its stats.", 3)
      .attr(ProtectStatAbAttr),
    new Ability(Abilities.WONDER_GUARD, "Wonder Guard", "Only super effective moves will hit.", 3)
      .attr(NonSuperEffectiveImmunityAbAttr),
    new Ability(Abilities.ADAPTABILITY, "Adaptability (N)", "Powers up moves of the same type.", 4),
    new Ability(Abilities.AFTERMATH, "Aftermath (N)", "Damages the attacker landing the finishing hit.", 4),
    new Ability(Abilities.ANGER_POINT, "Anger Point (N)", "Maxes ATTACK after taking a critical hit.", 4),
    new Ability(Abilities.ANTICIPATION, "Anticipation (N)", "Senses a foe's dangerous moves.", 4),
    new Ability(Abilities.BAD_DREAMS, "Bad Dreams (N)", "Reduces a sleeping foe's HP.", 4),
    new Ability(Abilities.DOWNLOAD, "Download (N)", "Adjusts power according to a foe's defenses.", 4),
    new Ability(Abilities.DRY_SKIN, "Dry Skin", "Reduces HP if it is hot. Water restores HP.", 4)
      .attr(PostWeatherLapseDamageAbAttr, 2, WeatherType.SUNNY, WeatherType.HARSH_SUN)
      .attr(PostWeatherLapseHealAbAttr, 2, WeatherType.RAIN, WeatherType.HEAVY_RAIN)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.FIRE, 1.25)
      .attr(TypeImmunityHealAbAttr, Type.WATER),
    new Ability(Abilities.FILTER, "Filter (N)", "Reduces damage from super-effective attacks.", 4),
    new Ability(Abilities.FLOWER_GIFT, "Flower Gift (N)", "Powers up party POKéMON when it is sunny.", 4),
    new Ability(Abilities.FOREWARN, "Forewarn (N)", "Determines what moves a foe has.", 4),
    new Ability(Abilities.FRISK, "Frisk (N)", "The POKéMON can check a foe's held item.", 4),
    new Ability(Abilities.GLUTTONY, "Gluttony (N)", "Encourages the early use of a held Berry.", 4),
    new Ability(Abilities.HEATPROOF, "Heatproof", "Weakens the power of FIRE-type moves.", 4)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.FIRE, 0.5),
    new Ability(Abilities.HONEY_GATHER, "Honey Gather (N)", "The POKéMON may gather Honey from somewhere.", 4),
    new Ability(Abilities.HYDRATION, "Hydration (N)", "Heals status problems if it is raining.", 4),
    new Ability(Abilities.ICE_BODY, "Ice Body", "The POKéMON gradually regains HP in a hailstorm.", 4)
      .attr(PostWeatherLapseHealAbAttr, 1, WeatherType.HAIL),
    new Ability(Abilities.IRON_FIST, "Iron Fist (N)", "Boosts the power of punching moves.", 4),
    new Ability(Abilities.KLUTZ, "Klutz (N)", "The POKéMON can't use any held items.", 4),
    new Ability(Abilities.LEAF_GUARD, "Leaf Guard", "Prevents problems with status in sunny weather.", 4)
      .attr(StatusEffectImmunityAbAttr)
      .condition(getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN)),
    new Ability(Abilities.MAGIC_GUARD, "Magic Guard (N)", "Protects the POKéMON from indirect damage.", 4),
    new Ability(Abilities.MOLD_BREAKER, "Mold Breaker (N)", "Moves can be used regardless of Abilities.", 4),
    new Ability(Abilities.MOTOR_DRIVE, "Motor Drive", "Raises SPEED if hit by an ELECTRIC-type move.", 4)
      .attr(TypeImmunityStatChangeAbAttr, Type.ELECTRIC, BattleStat.SPD, 1),
    new Ability(Abilities.MULTITYPE, "Multitype (N)", "Changes type to match the held Plate.", 4),
    new Ability(Abilities.NO_GUARD, "No Guard (N)", "Ensures attacks by or against the POKéMON land.", 4),
    new Ability(Abilities.NORMALIZE, "Normalize (N)", "All the POKéMON's moves become the NORMAL type.", 4),
    new Ability(Abilities.POISON_HEAL, "Poison Heal (N)", "Restores HP if the POKéMON is poisoned.", 4),
    new Ability(Abilities.QUICK_FEET, "Quick Feet (N)", "Boosts SPEED if there is a status problem.", 4),
    new Ability(Abilities.RECKLESS, "Reckless", "Powers up moves that have recoil damage.", 4)
      .attr(RecoilMovePowerBoostAbAttr),
    new Ability(Abilities.RIVALRY, "Rivalry (N)", "Deals more damage to a POKéMON of same gender.", 4),
    new Ability(Abilities.SCRAPPY, "Scrappy (N)", "Enables moves to hit GHOST-type POKéMON.", 4),
    new Ability(Abilities.SIMPLE, "Simple (N)", "Doubles all stat changes.", 4),
    new Ability(Abilities.SKILL_LINK, "Skill Link (N)", "Increases the frequency of multi-strike moves.", 4),
    new Ability(Abilities.SLOW_START, "Slow Start (N)", "Temporarily halves ATTACK and SPEED.", 4),
    new Ability(Abilities.SNIPER, "Sniper (N)", "Powers up moves if they become critical hits.", 4),
    new Ability(Abilities.SNOW_CLOAK, "Snow Cloak", "Raises evasion in a hailstorm.", 4)
      .attr(BattleStatMultiplierAbAttr, BattleStat.EVA, 1.2)
      .attr(BlockWeatherDamageAttr, WeatherType.HAIL),
    new Ability(Abilities.SNOW_WARNING, "Snow Warning", "The POKéMON summons a hailstorm in battle.", 4)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.HAIL),
    new Ability(Abilities.SOLAR_POWER, "Solar Power (N)", "In sunshine, SP. ATK is boosted but HP decreases.", 4),
    new Ability(Abilities.SOLID_ROCK, "Solid Rock (N)", "Reduces damage from super-effective attacks.", 4),
    new Ability(Abilities.STALL, "Stall (N)", "The POKéMON moves after all other POKéMON do.", 4),
    new Ability(Abilities.STEADFAST, "Steadfast (N)", "Raises SPEED each time the POKéMON flinches.", 4),
    new Ability(Abilities.STORM_DRAIN, "Storm Drain", "Draws in all WATER-type moves to up SP. ATK.", 4)
      .attr(TypeImmunityStatChangeAbAttr, Type.WATER, BattleStat.SPATK, 1),
    new Ability(Abilities.SUPER_LUCK, "Super Luck (N)", "Heightens the critical-hit ratios of moves.", 4),
    new Ability(Abilities.TANGLED_FEET, "Tangled Feet (N)", "Raises evasion if the POKéMON is confused.", 4),
    new Ability(Abilities.TECHNICIAN, "Technician (N)", "Powers up the POKéMON's weaker moves.", 4),
    new Ability(Abilities.TINTED_LENS, "Tinted Lens (N)", "Powers up \"not very effective\" moves.", 4),
    new Ability(Abilities.UNAWARE, "Unaware (N)", "Ignores any stat changes in the POKéMON.", 4),
    new Ability(Abilities.UNBURDEN, "Unburden (N)", "Raises SPEED if a held item is used.", 4),
    new Ability(Abilities.ANALYTIC, "Analytic (N)", "Boosts move power when the POKéMON moves last.", 5),
    new Ability(Abilities.BIG_PECKS, "Big Pecks", "Protects the POKéMON from DEFENSE-lowering attacks.", 5)
      .attr(ProtectStatAbAttr, BattleStat.DEF),
    new Ability(Abilities.CONTRARY, "Contrary (N)", "Makes stat changes have an opposite effect.", 5),
    new Ability(Abilities.CURSED_BODY, "Cursed Body (N)", "May disable a move used on the POKéMON.", 5),
    new Ability(Abilities.DEFEATIST, "Defeatist (N)", "Lowers stats when HP drops below half.", 5),
    new Ability(Abilities.DEFIANT, "Defiant (N)", "Sharply raises ATTACK when the POKéMON's stats are lowered.", 5),
    new Ability(Abilities.FLARE_BOOST, "Flare Boost (N)", "Powers up special attacks when burned.", 5),
    new Ability(Abilities.FRIEND_GUARD, "Friend Guard (N)", "Reduces damage done to allies.", 5),
    new Ability(Abilities.HARVEST, "Harvest (N)", "May create another Berry after one is used.", 5),
    new Ability(Abilities.HEALER, "Healer (N)", "May heal an ally's status conditions.", 5),
    new Ability(Abilities.HEAVY_METAL, "Heavy Metal (N)", "Doubles the POKéMON's weight.", 5),
    new Ability(Abilities.ILLUSION, "Illusion (N)", "Enters battle disguised as the last POKéMON in the party.", 5),
    new Ability(Abilities.IMPOSTER, "Imposter (N)", "It transforms itself into the POKéMON it is facing.", 5),
    new Ability(Abilities.INFILTRATOR, "Infiltrator (N)", "Passes through the foe's barrier and strikes.", 5),
    new Ability(Abilities.IRON_BARBS, "Iron Barbs (N)", "Inflicts damage to the POKéMON on contact.", 5),
    new Ability(Abilities.JUSTIFIED, "Justified (N)", "Raises ATTACK when hit by a DARK-type move.", 5),
    new Ability(Abilities.LIGHT_METAL, "Light Metal (N)", "Halves the POKéMON's weight.", 5),
    new Ability(Abilities.MAGIC_BOUNCE, "Magic Bounce (N)", "Reflects status- changing moves.", 5),
    new Ability(Abilities.MOODY, "Moody (N)", "Raises one stat and lowers another.", 5),
    new Ability(Abilities.MOXIE, "Moxie (N)", "Boosts ATTACK after knocking out any POKéMON.", 5),
    new Ability(Abilities.MULTISCALE, "Multiscale (N)", "Reduces damage when HP is full.", 5),
    new Ability(Abilities.MUMMY, "Mummy (N)", "Contact with this POKéMON spreads this Ability.", 5),
    new Ability(Abilities.OVERCOAT, "Overcoat", "Protects the POKéMON from weather damage.", 5)
      .attr(BlockWeatherDamageAttr),
    new Ability(Abilities.PICKPOCKET, "Pickpocket (N)", "Once per battle, steals an item when hit by another POKéMON.", 5),
    new Ability(Abilities.POISON_TOUCH, "Poison Touch", "May poison targets when a POKéMON makes contact.", 5)
      .attr(PostDefendContactApplyStatusEffectAbAttr, 30, StatusEffect.POISON),
    new Ability(Abilities.PRANKSTER, "Prankster (N)", "Gives priority to a status move.", 5),
    new Ability(Abilities.RATTLED, "Rattled (N)", "BUG, GHOST or DARK type moves scare it and boost its SPEED.", 5),
    new Ability(Abilities.REGENERATOR, "Regenerator (N)", "Restores a little HP when withdrawn from battle.", 5),
    new Ability(Abilities.SAND_FORCE, "Sand Force (N)", "Boosts certain moves' power in a sandstorm.", 5),
    new Ability(Abilities.SAND_RUSH, "Sand Rush (N)", "Boosts the POKéMON's SPEED in a sandstorm.", 5),
    new Ability(Abilities.SAP_SIPPER, "Sap Sipper", "Boosts ATTACK when hit by a GRASS-type move.", 5)
      .attr(TypeImmunityStatChangeAbAttr, Type.GRASS, BattleStat.ATK, 1),
    new Ability(Abilities.SHEER_FORCE, "Sheer Force (N)", "Removes added effects to increase move damage.", 5),
    new Ability(Abilities.TELEPATHY, "Telepathy (N)", "Anticipates an ally's ATTACK and dodges it.", 5),
    new Ability(Abilities.TERAVOLT, "Teravolt (N)", "Moves can be used regardless of Abilities.", 5),
    new Ability(Abilities.TOXIC_BOOST, "Toxic Boost (N)", "Powers up physical attacks when poisoned.", 5),
    new Ability(Abilities.TURBOBLAZE, "Turboblaze (N)", "Moves can be used regardless of Abilities.", 5),
    new Ability(Abilities.UNNERVE, "Unnerve (N)", "Makes the foe nervous and unable to eat Berries.", 5),
    new Ability(Abilities.VICTORY_STAR, "Victory Star (N)", "Boosts the accuracy of its allies and itself.", 5),
    new Ability(Abilities.WEAK_ARMOR, "Weak Armor (N)", "Physical attacks lower DEFENSE and raise SPEED.", 5),
    new Ability(Abilities.WONDER_SKIN, "Wonder Skin (N)", "Makes status-changing moves more likely to miss.", 5),
    new Ability(Abilities.ZEN_MODE, "Zen Mode (N)", "Changes form when HP drops below half.", 5),
    new Ability(Abilities.COMPETITIVE, "Competitive (N)", "Sharply raises SP. ATK when the POKéMON's stats are lowered.", 6),
    new Ability(Abilities.DARK_AURA, "Dark Aura (N)", "Raises power of DARK type moves for all POKéMON in battle.", 6),
    new Ability(Abilities.FAIRY_AURA, "Fairy Aura (N)", "Raises power of FAIRY type moves for all POKéMON in battle.", 6),
    new Ability(Abilities.PROTEAN, "Protean (N)", "Changes the POKéMON's type to its last used move.", 6),
    new Ability(Abilities.SLUSH_RUSH, "Slush Rush (N)", "Boosts the POKéMON's SPEED stat in a hailstorm.", 7),
    new Ability(Abilities.NEUTRALIZING_GAS, "Neutralizing Gas (N)", "Neutralizes abilities of all POKéMON in battle.", 8)
  );
}