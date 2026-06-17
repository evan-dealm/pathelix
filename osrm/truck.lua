-- ─── truck.lua — Profil OSRM Poids Lourd (Bennes 26t / Ampliroll) ───────────
--
-- Base : profil car.lua officiel OSRM, adapte pour les poids lourds.
-- Prend en compte :
--   - maxweight (26t par defaut)
--   - maxheight (4.0m par defaut)
--   - maxwidth (2.55m par defaut)
--   - hgv=no / goods=no / motor_vehicle=no
--   - Vitesses reduites (PL = 80 km/h max sur route, 90 autoroute)
--   - Penalite demi-tour forte (manoeuvre camion = difficile)

api_version = 4

Set = require('lib/set')
Sequence = require('lib/sequence')
Handlers = require('lib/way_handlers')
Relations = require('lib/relations')
find_access_tag = require('lib/access').find_access_tag
limit = require('lib/maxspeed').limit

-- ─── Dimensions du vehicule ──────────────────────────────────────────────────
-- Configurable via les variables d'env OSRM (ou modifier ici)

local VEHICLE_WEIGHT  = 26    -- tonnes (PTAC ampliroll charge)
local VEHICLE_HEIGHT  = 4.0   -- metres
local VEHICLE_WIDTH   = 2.55  -- metres
local VEHICLE_LENGTH  = 12.0  -- metres

function setup()
  return {
    properties = {
      -- Identifiant du profil
      weight_name                   = 'duration',
      process_call_tagless_node     = false,
      u_turn_penalty                = 40,     -- 40s penalite demi-tour (vs 20s voiture)
      continue_straight_at_waypoint = true,
      use_turn_restrictions         = true,
      left_hand_driving             = false,
      traffic_signal_penalty        = 3,      -- 3s aux feux (camion = redemarrage lent)
      max_speed_for_map_matching    = 90/3.6, -- 90 km/h max matching
      max_turn_weight               = 15,     -- penalite virages serres
    },

    default_mode      = mode.driving,
    default_speed     = 50,

    -- Vitesses max par type de route (km/h) — reglementaire PL France
    speeds = Sequence {
      highway = {
        motorway        = 90,    -- autoroute PL
        motorway_link   = 45,
        trunk           = 80,    -- nationale
        trunk_link      = 40,
        primary         = 70,    -- departementale
        primary_link    = 35,
        secondary       = 60,
        secondary_link  = 30,
        tertiary        = 50,
        tertiary_link   = 25,
        unclassified    = 40,
        residential     = 30,
        living_street   = 10,
        service         = 15,
      }
    },

    -- Hierarchie des tags d'acces (du plus specifique au moins)
    access_tag_whitelist = Set {
      'yes', 'motorcar', 'motor_vehicle', 'vehicle', 'permissive',
      'designated', 'hgv', 'goods', 'bus', 'psv', 'delivery'
    },

    access_tag_blacklist = Set {
      'no', 'agricultural', 'forestry', 'private'
    },

    -- Tags a verifier pour les restrictions PL
    access_tags_hierarchy = Sequence {
      'hgv', 'goods', 'motor_vehicle', 'vehicle', 'access'
    },

    restricted_access_tag_list = Set {
      'private', 'delivery', 'destination', 'customers'
    },

    service_tag_forbidden = Set {
      'emergency_access'
    },

    -- Penalites de surface
    surface_speeds = {
      asphalt   = nil,  -- pas de penalite
      concrete  = nil,
      paved     = nil,
      cobblestone = 25,
      gravel    = 20,
      unpaved   = 15,
      dirt      = 10,
      ground    = 10,
      mud       = 0,    -- interdit
      sand      = 0,
    },
  }
end

function process_node(profile, node, result, relations)
  -- Barriere infranchissable par PL
  local barrier = node:get_value_by_key("barrier")
  if barrier then
    local dominated = Set { 'bollard', 'gate', 'lift_gate', 'swing_gate', 'chain', 'block' }
    if dominated[barrier] then
      -- Verifier si hgv=yes
      local hgv_access = node:get_value_by_key("hgv")
      if hgv_access ~= 'yes' and hgv_access ~= 'designated' then
        result.barrier = true
      end
    end
  end

  -- Feux tricolores : penalite redemarrage PL
  local traffic_signal = node:get_value_by_key("highway")
  if traffic_signal == "traffic_signals" then
    result.traffic_lights = true
  end
end

function process_way(profile, way, result, relations)
  local data = {
    highway = way:get_value_by_key('highway'),
    route   = way:get_value_by_key('route'),
    bridge  = way:get_value_by_key('bridge'),
    tunnel  = way:get_value_by_key('tunnel'),
  }

  if not data.highway or data.highway == '' then
    return
  end

  -- ── 1. Verifier l'acces PL ─────────────────────────────────────────────────

  -- Tag hgv=no ou goods=no → route interdite aux PL
  for _, tag in ipairs(profile.access_tags_hierarchy) do
    local value = way:get_value_by_key(tag)
    if value then
      if profile.access_tag_blacklist[value] then
        return  -- route interdite
      end
      break  -- premier tag trouve = determinant
    end
  end

  -- ── 2. Restrictions physiques (poids, hauteur, largeur) ────────────────────

  local maxweight = tonumber(way:get_value_by_key('maxweight'))
  if maxweight and maxweight < VEHICLE_WEIGHT then
    return  -- pont ou route avec limite de tonnage
  end

  local maxheight = tonumber(way:get_value_by_key('maxheight'))
  if maxheight and maxheight < VEHICLE_HEIGHT then
    return  -- pont bas, tunnel etroit
  end

  local maxwidth = tonumber(way:get_value_by_key('maxwidth'))
  if maxwidth and maxwidth < VEHICLE_WIDTH then
    return  -- rue trop etroite
  end

  local maxlength = tonumber(way:get_value_by_key('maxlength'))
  if maxlength and maxlength < VEHICLE_LENGTH then
    return  -- virage trop serre
  end

  -- ── 3. Vitesse de base ─────────────────────────────────────────────────────

  local speed = profile.speeds.highway[data.highway]
  if not speed then
    return  -- type de route non supporte (track, path, etc.)
  end

  -- Vitesse max reglementaire depuis les tags OSM
  local maxspeed = tonumber(way:get_value_by_key('maxspeed'))
  if maxspeed then
    speed = math.min(speed, maxspeed)
  end

  -- Limite maxspeed:hgv (specifique PL)
  local maxspeed_hgv = tonumber(way:get_value_by_key('maxspeed:hgv'))
  if maxspeed_hgv then
    speed = math.min(speed, maxspeed_hgv)
  end

  -- ── 4. Penalites de surface ────────────────────────────────────────────────

  local surface = way:get_value_by_key('surface')
  if surface and profile.surface_speeds[surface] then
    if profile.surface_speeds[surface] == 0 then
      return  -- surface impraticable
    end
    speed = math.min(speed, profile.surface_speeds[surface])
  end

  -- ── 5. Sens unique ─────────────────────────────────────────────────────────

  local oneway = way:get_value_by_key('oneway')
  if oneway == 'yes' or oneway == '1' or oneway == 'true' then
    result.forward_mode  = mode.driving
    result.backward_mode = mode.inaccessible
  elseif oneway == '-1' then
    result.forward_mode  = mode.inaccessible
    result.backward_mode = mode.driving
  else
    result.forward_mode  = mode.driving
    result.backward_mode = mode.driving
  end

  -- ── 6. Appliquer la vitesse ────────────────────────────────────────────────

  result.forward_speed  = speed
  result.backward_speed = speed
  result.name = way:get_value_by_key('name') or ''
end

function process_turn(profile, turn)
  -- Penalite pour les virages (PL = rayon de braquage large)
  if turn.is_u_turn then
    turn.duration = turn.duration + profile.properties.u_turn_penalty
  end

  -- Penalite angle serre (> 120 degres de rotation)
  if math.abs(turn.angle) > 120 then
    turn.duration = turn.duration + 10  -- 10s penalite virage serre
  elseif math.abs(turn.angle) > 90 then
    turn.duration = turn.duration + 5   -- 5s virage a angle droit
  end
end

return {
  setup = setup,
  process_way = process_way,
  process_node = process_node,
  process_turn = process_turn,
}
